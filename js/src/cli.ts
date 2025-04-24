#!/usr/bin/env node

import * as esbuild from "esbuild";
import * as dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import util from "util";
import * as fsWalk from "@nodelib/fs.walk";
import { minimatch } from "minimatch";
import { ArgumentParser } from "argparse";
import { v4 as uuidv4 } from "uuid";
import pluralize from "pluralize";
import {
  login,
  init as _initExperiment,
  Experiment,
  BaseMetadata,
  Dataset,
} from "./logger";
import {
  BarProgressReporter,
  SimpleProgressReporter,
  ProgressReporter,
} from "./progress";

// Re-use the module resolution logic from Jest
import {
  EvalData,
  EvaluatorDef,
  EvaluatorFile,
  Filter,
  ReporterDef,
  callEvaluatorData,
  defaultReporter,
  error,
  logError,
  parseFilters,
  runEvaluator,
  warning,
} from "./framework";
import { configureNode } from "./node";
import { isEmpty } from "./util";
import { loadEnvConfig } from "@next/env";
import { uploadHandleBundles } from "./functions/upload";
import { loadModule } from "./functions/load-module";
import { bundleCommand } from "./cli-util/bundle";
import { RunArgs } from "./cli-util/types";
import { pullCommand } from "./cli-util/pull";
import { runDevServer } from "../dev/server";

// This requires require
// https://stackoverflow.com/questions/50822310/how-to-import-package-json-in-typescript
const { version } = require("../package.json");

// TODO: This could be loaded from configuration
const INCLUDE_EVAL = [
  "**/*.eval.ts",
  "**/*.eval.tsx",
  "**/*.eval.js",
  "**/*.eval.jsx",
];
const INCLUDE_BUNDLE = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];
const EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/build/**"];
const OUT_EXT = "js";

configureNode();

export interface BuildSuccess {
  type: "success";
  result: esbuild.BuildResult;
  evaluator: EvaluatorFile;
  sourceFile: string;
}

export interface BuildFailure {
  type: "failure";
  error: Error;
  sourceFile: string;
}

export type BtBuildResult = BuildSuccess | BuildFailure;
export interface FileHandle {
  inFile: string;
  outFile: string;
  bundleFile?: string;
  rebuild: () => Promise<BtBuildResult>;
  bundle: () => Promise<esbuild.BuildResult>;
  watch: () => void;
  destroy: () => Promise<void>;
}

function evaluateBuildResults(
  inFile: string,
  buildResult: esbuild.BuildResult,
): EvaluatorFile | null {
  if (!buildResult.outputFiles) {
    return null;
  }
  const moduleText = buildResult.outputFiles[0].text;
  return loadModule({ inFile, moduleText });
}

async function initExperiment(
  evaluator: EvaluatorDef<unknown, unknown, unknown, BaseMetadata>,
  evaluatorData: {
    data: EvalData<unknown, unknown, BaseMetadata>;
    baseExperiment: string | undefined;
  },
) {
  const { data, baseExperiment: defaultBaseExperiment } = evaluatorData;
  // NOTE: This code is duplicated with initExperiment in js/src/framework.ts.
  // Make sure to update that if you change this.
  const logger = _initExperiment({
    state: evaluator.state,
    ...(evaluator.projectId
      ? { projectId: evaluator.projectId }
      : { project: evaluator.projectName }),
    experiment: evaluator.experimentName,
    description: evaluator.description,
    metadata: evaluator.metadata,
    isPublic: evaluator.isPublic,
    update: evaluator.update,
    baseExperiment: evaluator.baseExperimentName ?? defaultBaseExperiment,
    baseExperimentId: evaluator.baseExperimentId,
    gitMetadataSettings: evaluator.gitMetadataSettings,
    repoInfo: evaluator.repoInfo,
    dataset: Dataset.isDataset(data) ? data : undefined,
    setCurrent: false,
  });
  const info = await logger.summarize({ summarizeScores: false });
  console.error(
    `Experiment ${info.experimentName} is running at ${info.experimentUrl}`,
  );
  return logger;
}

function resolveReporter(
  reporter: string | ReporterDef<unknown> | undefined,
  reporters: Record<string, ReporterDef<unknown>>,
) {
  if (typeof reporter === "string") {
    if (!reporters[reporter]) {
      throw new Error(`Reporter ${reporter} not found`);
    }
    return reporters[reporter];
  } else if (!isEmpty(reporter)) {
    return reporter;
  } else if (Object.keys(reporters).length === 0) {
    return defaultReporter;
  } else if (Object.keys(reporters).length === 1) {
    return reporters[Object.keys(reporters)[0]];
  } else {
    const reporterNames = Object.keys(reporters).join(", ");
    throw new Error(
      `Multiple reporters found (${reporterNames}). Please specify a reporter explicitly.`,
    );
  }
}

type AllReports = Record<
  string,
  {
    reporter: ReporterDef<unknown>;
    results: (unknown | Promise<unknown>)[];
  }
>;

function addReport(
  evalReports: AllReports,
  reporter: ReporterDef<unknown>,
  report: unknown,
) {
  if (!evalReports[reporter.name]) {
    evalReports[reporter.name] = {
      reporter,
      results: [],
    };
  }
  evalReports[reporter.name].results.push(report);
}

function buildWatchPluginForEvaluator(
  inFile: string,
  opts: EvaluatorOpts,
): esbuild.Plugin {
  const evaluators: EvaluatorState = {
    evaluators: [],
    reporters: {},
  };
  const plugin = {
    name: "run-evalutator-on-end",
    setup(build: esbuild.PluginBuild) {
      build.onEnd(async (result) => {
        console.error(`Done building ${inFile}`);

        if (!result.outputFiles) {
          if (opts.verbose) {
            console.warn(`Failed to compile ${inFile}`);
            console.warn(result.errors);
          } else {
            console.warn(`Failed to compile ${inFile}: ${result.errors}`);
          }
          return;
        }

        const evalResult = evaluateBuildResults(inFile, result);
        if (!evalResult) {
          return;
        }

        evaluators.evaluators = evaluators.evaluators.filter(
          (e) => e.sourceFile !== inFile,
        );

        // Update the evaluators and reporters
        for (const evaluator of Object.values(evalResult.evaluators)) {
          evaluators.evaluators.push({
            sourceFile: inFile,
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            evaluator: evaluator.evaluator as EvaluatorDef<
              unknown,
              unknown,
              unknown,
              BaseMetadata
            >,
            reporter: evaluator.reporter,
          });
        }
        for (const [reporterName, reporter] of Object.entries(
          evalResult.reporters,
        )) {
          evaluators.reporters[reporterName] = reporter;
        }

        const evalReports: Record<
          string,
          {
            reporter: ReporterDef<unknown>;
            results: unknown[];
          }
        > = {};
        for (const evaluatorDef of Object.values(evalResult.evaluators)) {
          const { evaluator, reporter } = evaluatorDef;
          const evalData = callEvaluatorData(evaluator.data);
          const logger = opts.noSendLogs
            ? null
            : await initExperiment(evaluator, evalData);
          const evaluatorResult = await runEvaluator(
            logger,
            {
              ...evaluator,
              data: evalData.data,
            },
            opts.progressReporter,
            opts.filters,
            undefined,
            undefined,
          );
          const resolvedReporter = resolveReporter(
            reporter,
            evaluators.reporters, // Let these accumulate across all files.
          );

          const report = resolvedReporter.reportEval(
            evaluator,
            evaluatorResult,
            {
              verbose: opts.verbose,
              jsonl: opts.jsonl,
            },
          );

          addReport(evalReports, resolvedReporter, report);
        }

        for (const [reporterName, { reporter, results }] of Object.entries(
          evalReports,
        )) {
          const success = await reporter.reportRun(await Promise.all(results));
          if (!success) {
            console.error(error(`Reporter ${reporterName} failed.`));
          }
        }
      });
    },
  };

  return plugin;
}

async function initFile({
  inFile,
  outFile,
  bundleFile,
  tsconfig,
  plugins,
}: {
  inFile: string;
  outFile: string;
  bundleFile: string;
  tsconfig?: string;
  plugins?: PluginMaker[];
}): Promise<FileHandle> {
  const buildOptions = buildOpts({
    fileName: inFile,
    outFile,
    tsconfig,
    plugins,
  });
  const ctx = await esbuild.context(buildOptions);

  return {
    inFile,
    outFile,
    bundleFile,
    rebuild: async () => {
      try {
        const result = await ctx.rebuild();
        if (!result.outputFiles) {
          return {
            type: "failure",
            error: new Error("No output file generated"),
            sourceFile: inFile,
          };
        }
        const evaluator = evaluateBuildResults(inFile, result) || {
          functions: [],
          prompts: [],
          evaluators: {},
          reporters: {},
        };
        return { type: "success", result, evaluator, sourceFile: inFile };
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        return { type: "failure", error: e as Error, sourceFile: inFile };
      }
    },
    bundle: async () => {
      const buildOptions: esbuild.BuildOptions = {
        ...buildOpts({
          fileName: inFile,
          outFile: bundleFile,
          tsconfig,
          plugins,
        }),
        external: [],
        write: true,
        plugins: [],
        minify: true,
        sourcemap: true,
      };
      return await esbuild.build(buildOptions);
    },
    watch: () => {
      ctx.watch();
    },
    destroy: async () => {
      await ctx.dispose();
    },
  };
}

export interface EvaluatorState {
  evaluators: {
    sourceFile: string;
    evaluator: EvaluatorDef<unknown, unknown, unknown, BaseMetadata>;
    reporter: string | ReporterDef<unknown> | undefined;
  }[];
  reporters: {
    [reporter: string]: ReporterDef<unknown>;
  };
}

interface EvaluatorOpts {
  verbose: boolean;
  apiKey?: string;
  orgName?: string;
  appUrl?: string;
  noSendLogs: boolean;
  bundle: boolean;
  setCurrent: boolean;
  terminateOnFailure: boolean;
  watch: boolean;
  list: boolean;
  jsonl: boolean;
  filters: Filter[];
  progressReporter: ProgressReporter;
}

export function handleBuildFailure({
  result,
  terminateOnFailure,
  verbose,
}: {
  result: BuildFailure;
  terminateOnFailure: boolean;
  verbose: boolean;
}) {
  if (terminateOnFailure) {
    throw result.error;
  } else if (verbose) {
    console.warn(`Failed to compile ${result.sourceFile}`);
    console.warn(result.error);
  } else {
    console.warn(
      `Failed to compile ${result.sourceFile}: ${result.error.message}`,
    );
  }
}

function updateEvaluators(
  evaluators: EvaluatorState,
  buildResults: BtBuildResult[],
  opts: EvaluatorOpts,
) {
  for (const result of buildResults) {
    if (result.type === "failure") {
      handleBuildFailure({
        result,
        terminateOnFailure: opts.terminateOnFailure,
        verbose: opts.verbose,
      });
      continue;
    }

    for (const evaluator of Object.values(result.evaluator.evaluators)) {
      evaluators.evaluators.push({
        sourceFile: result.sourceFile,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        evaluator: evaluator.evaluator as EvaluatorDef<
          unknown,
          unknown,
          unknown,
          BaseMetadata
        >,
        reporter: evaluator.reporter,
      });
    }

    for (const [reporterName, reporter] of Object.entries(
      result.evaluator.reporters,
    )) {
      if (
        evaluators.reporters[reporterName] &&
        evaluators.reporters[reporterName] !== reporter
      ) {
        console.warn(
          warning(
            `Reporter '${reporterName}' already exists. Will skip '${reporterName}' from ${result.sourceFile}.`,
          ),
        );
        continue;
      }
      evaluators.reporters[reporterName] = reporter;
    }
  }
}

async function runAndWatch({
  handles,
  onExit,
}: {
  handles: Record<string, FileHandle>;
  onExit?: () => void;
}) {
  const count = Object.keys(handles).length;
  console.error(`Watching ${pluralize("file", count, true)}...`);

  Object.values(handles).map((handle) => handle.watch());

  ["SIGINT", "SIGTERM"].forEach((signal: string) => {
    process.on(signal, function () {
      console.error("Stopped watching.");
      for (const handle of Object.values(handles)) {
        handle.destroy();
      }
      onExit?.();
      process.exit(0);
    });
  });

  // Wait forever while we watch.
  await new Promise(() => {});
}

export async function buildEvaluators(
  handles: Record<string, FileHandle>,
  opts: EvaluatorOpts,
): Promise<{ evaluators: EvaluatorState; buildResults: BtBuildResult[] }> {
  const buildPromises = Object.values(handles).map((handle) =>
    handle.rebuild(),
  );

  const buildResults = await Promise.all(buildPromises);

  const evaluators: EvaluatorState = {
    evaluators: [],
    reporters: {},
  };
  updateEvaluators(evaluators, buildResults, opts);
  return { evaluators, buildResults };
}

async function runOnce(
  handles: Record<string, FileHandle>,
  opts: EvaluatorOpts,
) {
  const bundlePromises = opts.bundle
    ? Object.fromEntries(
        Object.entries(handles).map(([inFile, handle]) => [
          inFile,
          handle.bundle(),
        ]),
      )
    : null;

  const { evaluators, buildResults } = await buildEvaluators(handles, opts);

  if (opts.list) {
    for (const evaluator of evaluators.evaluators) {
      console.log(evaluator.evaluator.evalName);
    }
    return true;
  }

  // map from file name -> eval name -> experiment
  const evalToExperiment: Record<string, Record<string, Experiment>> = {};

  const resultPromises = evaluators.evaluators.map(async (evaluator) => {
    const evalData = callEvaluatorData(evaluator.evaluator.data);
    // TODO: For now, use the eval name as the project. However, we need to evolve
    // the definition of a project and create a new concept called run, so that we
    // can name the experiment/evaluation within the run the evaluator's name.
    const logger = opts.noSendLogs
      ? null
      : await initExperiment(evaluator.evaluator, evalData);
    try {
      return await runEvaluator(
        logger,
        {
          ...evaluator.evaluator,
          data: evalData.data,
        },
        opts.progressReporter,
        opts.filters,
        undefined,
        undefined,
      );
    } finally {
      if (logger) {
        if (!evalToExperiment[evaluator.sourceFile]) {
          evalToExperiment[evaluator.sourceFile] = {};
        }
        evalToExperiment[evaluator.sourceFile][evaluator.evaluator.evalName] =
          logger;

        await logger.flush();
      }
    }
  });

  console.error(`Processing ${resultPromises.length} evaluators...`);
  const allEvalsResults = await Promise.all(resultPromises);
  opts.progressReporter.stop();
  console.error("");

  const evalReports: Record<
    string,
    {
      reporter: ReporterDef<unknown>;
      results: unknown[];
    }
  > = {};
  for (let idx = 0; idx < evaluators.evaluators.length; idx++) {
    const evaluator = evaluators.evaluators[idx];
    const resolvedReporter = resolveReporter(
      evaluator.reporter,
      evaluators.reporters,
    );

    const report = resolvedReporter.reportEval(
      evaluator.evaluator,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      allEvalsResults[idx as number],
      {
        verbose: opts.verbose,
        jsonl: opts.jsonl,
      },
    );

    addReport(evalReports, resolvedReporter, report);
  }

  if (bundlePromises !== null && Object.entries(evalToExperiment).length > 0) {
    await uploadHandleBundles({
      buildResults: buildResults.filter(
        // We handle errors above, so it's fine to filter down to successes here.
        (result): result is BuildSuccess => result.type === "success",
      ),
      evalToExperiment,
      bundlePromises,
      handles,
      setCurrent: opts.setCurrent,
      defaultIfExists: "replace",
      verbose: opts.verbose,
    });
  }

  let allSuccess = true;
  for (const [_reporterName, { reporter, results }] of Object.entries(
    evalReports,
  )) {
    const success = await reporter.reportRun(await Promise.all(results));
    allSuccess = allSuccess && success;
  }

  return allSuccess;
}

function checkMatch(
  pathInput: string,
  include_patterns: string[] | null,
  exclude_patterns: string[] | null,
): boolean {
  const p = path.resolve(pathInput);
  if (include_patterns !== null) {
    let include = false;
    for (const pattern of include_patterns) {
      if (minimatch(p, pattern)) {
        include = true;
        break;
      }
    }
    if (!include) {
      return false;
    }
  }

  if (exclude_patterns !== null) {
    let exclude = false;
    for (const pattern of exclude_patterns) {
      if (minimatch(p, pattern)) {
        exclude = true;
        break;
      }
    }

    return !exclude;
  }

  return true;
}

async function collectFiles(
  inputPath: string,
  mode: "eval" | "bundle",
): Promise<string[]> {
  let pathStat = null;
  try {
    pathStat = fs.lstatSync(inputPath);
  } catch (e) {
    console.error(error(`Error reading ${inputPath}: ${e}`));
    process.exit(1);
  }

  let files: string[] = [];
  if (!pathStat.isDirectory()) {
    if (
      !checkMatch(
        inputPath,
        mode === "eval" ? INCLUDE_EVAL : INCLUDE_BUNDLE,
        EXCLUDE,
      )
    ) {
      const prefix = mode === "eval" ? ".eval" : "";
      console.warn(
        warning(
          `Reading ${inputPath} because it was specified directly. Rename it to end in ${prefix}.ts or ` +
            `.${prefix}.js to include it automatically when you specify a directory.`,
        ),
      );
    }
    files.push(inputPath);
  } else {
    const walked = await util.promisify(fsWalk.walk)(inputPath, {
      deepFilter: (entry) => {
        return checkMatch(entry.path, null, EXCLUDE);
      },
      entryFilter: (entry) => {
        return (
          entry.dirent.isFile() &&
          checkMatch(
            entry.path,
            mode === "eval" ? INCLUDE_EVAL : INCLUDE_BUNDLE,
            EXCLUDE,
          )
        );
      },
    });

    files = files.concat(walked.map((entry) => entry.path));
  }

  return files;
}

// Inspired by https://github.com/evanw/esbuild/issues/619
// In addition to marking node_modules external, explicitly mark
// our packages (braintrust and autoevals) external, in case they're
// installed in a relative path.
const markKnownPackagesExternalPlugin = {
  name: "make-known-packages-external",
  setup(build: esbuild.PluginBuild) {
    // Mark known packages as external
    const knownPackagesFilter =
      /^(braintrust|autoevals|@braintrust\/|config|lightningcss)/;
    build.onResolve({ filter: knownPackagesFilter }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

// Inspired by and modified from https://github.com/evanw/esbuild/issues/1051
const nativeNodeModulesPlugin = {
  name: "native-node-modules",
  setup(build: esbuild.PluginBuild) {
    // Keep track of packages that contain .node files
    const nativePackages = new Set<string>();

    // Helper to add a package and its platform-specific variants
    const addNativePackage = (pkgName: string) => {
      nativePackages.add(pkgName);
      if (pkgName.includes("@")) {
        const [scope, name] = pkgName.split("/");
        const platformPkgs = [
          `${scope}/${name}-darwin-arm64`,
          `${scope}/${name}-darwin-x64`,
          `${scope}/${name}-linux-x64-gnu`,
          `${scope}/${name}-win32-x64-msvc`,
        ];
        platformPkgs.forEach((pkg) => nativePackages.add(pkg));
      }
    };

    // When a .node file is imported, mark its package as native
    build.onResolve({ filter: /\.node$/ }, (args) => {
      try {
        const path = require.resolve(args.path, { paths: [args.resolveDir] });
        const match = path.match(
          /node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)/,
        );
        if (match) {
          addNativePackage(match[1]);
        }
      } catch {
        // Ignore errors
      }
      return { path: args.path, external: true };
    });

    // Handle direct imports of native packages
    build.onResolve(
      { filter: /@[^/]+\/[^/]+-(?:darwin|linux|win32)/ },
      (args) => {
        const match = args.path.match(/^(@[^/]+\/[^/]+)/);
        if (match) {
          addNativePackage(match[1]);
        }
        return { path: args.path, external: true };
      },
    );

    // Mark all imports from native packages as external
    build.onResolve({ filter: /.*/ }, (args) => {
      if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
        const match = args.path.match(/^(?:@[^/]+\/)?[^/]+/);
        if (match && nativePackages.has(match[0])) {
          return { path: require.resolve(args.path), external: true };
        }
      }
      return null;
    });
  },
};

export type PluginMaker = (fileName: string) => esbuild.Plugin;

function buildOpts({
  fileName,
  outFile,
  tsconfig,
  plugins: argPlugins,
}: {
  fileName: string;
  outFile: string;
  tsconfig?: string;
  plugins?: PluginMaker[];
}): esbuild.BuildOptions {
  const plugins = [
    nativeNodeModulesPlugin,
    markKnownPackagesExternalPlugin,
    ...(argPlugins || []).map((fn) => fn(fileName)),
  ];
  return {
    entryPoints: [fileName],
    bundle: true,
    treeShaking: true,
    outfile: outFile,
    platform: "node",
    write: false,
    // Remove the leading "v" from process.version
    target: `node${process.version.slice(1)}`,
    tsconfig,
    external: ["node_modules/*", "fsevents"],
    plugins: plugins,
  };
}

export async function initializeHandles({
  files: inputFiles,
  mode,
  plugins,
  tsconfig,
}: {
  files: string[];
  mode: "eval" | "bundle";
  plugins?: PluginMaker[];
  tsconfig?: string;
}): Promise<Record<string, FileHandle>> {
  const files: Record<string, boolean> = {};
  const inputPaths = inputFiles.length > 0 ? inputFiles : ["."];
  for (const inputPath of inputPaths) {
    const newFiles = await collectFiles(inputPath, mode);
    if (newFiles.length == 0) {
      console.warn(
        warning(
          `Provided path ${inputPath} is not an eval file or a directory containing eval files, skipping...`,
        ),
      );
    }
    for (const file of newFiles) {
      files[path.resolve(file)] = true;
    }
  }

  if (Object.keys(files).length == 0) {
    console.warn(
      warning("No eval files were found in any of the provided paths."),
    );
    process.exit(0);
  }

  const tmpDir = path.join(os.tmpdir(), `btevals-${uuidv4().slice(0, 8)}`);
  // fs.mkdirSync(tmpDir, { recursive: true });

  const initPromises = [];
  for (const file of Object.keys(files)) {
    const baseName = `${path.basename(
      file,
      path.extname(file),
    )}-${uuidv4().slice(0, 8)}`;
    const outFile = path.join(tmpDir, `${baseName}.${OUT_EXT}`);
    const bundleFile = path.join(tmpDir, `${baseName}.bundle.js`);
    initPromises.push(
      initFile({
        inFile: file,
        outFile,
        bundleFile,
        plugins,
        tsconfig,
      }),
    );
  }

  const handles: Record<string, FileHandle> = {};
  const initResults = await Promise.all(initPromises);
  for (const result of initResults) {
    handles[result.inFile] = result;
  }
  return handles;
}

async function run(args: RunArgs) {
  // Load the environment variables from the .env files using the same rules as Next.js
  loadEnvConfig(process.cwd(), true);

  if (args.env_file) {
    // Load via dotenv library
    const loaded = dotenv.config({ path: args.env_file });
    if (loaded.error) {
      console.error(error(`Error loading ${args.env_file}: ${loaded.error}`));
      process.exit(1);
    }
  }

  const evaluatorOpts: EvaluatorOpts = {
    verbose: args.verbose,
    apiKey: args.api_key,
    orgName: args.org_name,
    appUrl: args.app_url,
    noSendLogs: !!args.no_send_logs,
    bundle: !!args.bundle || !!args.push,
    setCurrent: !!args.push,
    terminateOnFailure: !!args.terminate_on_failure,
    watch: !!args.watch,
    jsonl: args.jsonl,
    progressReporter: args.no_progress_bars
      ? new SimpleProgressReporter()
      : new BarProgressReporter(),
    filters: args.filter ? parseFilters(args.filter) : [],
    list: !!args.list,
  };

  if (args.list && args.watch) {
    console.error(error("Cannot specify both --list and --watch."));
    process.exit(1);
  }

  const plugins = evaluatorOpts.watch
    ? [
        (fileName: string) =>
          buildWatchPluginForEvaluator(fileName, evaluatorOpts),
      ]
    : [];

  const handles = await initializeHandles({
    files: args.files,
    mode: "eval",
    tsconfig: args.tsconfig,
    plugins,
  });

  if (args.dev) {
    // XXX We should watch these files (or support a --watch flag).
    const { evaluators } = await buildEvaluators(handles, evaluatorOpts);
    const allEvaluators = Object.values(evaluators.evaluators).map(
      (e) => e.evaluator,
    );
    runDevServer(allEvaluators, {
      host: args.dev_host,
      port: args.dev_port,
    });
    return;
  }

  let success = true;
  try {
    if (!evaluatorOpts.noSendLogs) {
      await login({
        apiKey: args.api_key,
        orgName: args.org_name,
        appUrl: args.app_url,
      });
    }

    if (args.watch) {
      await runAndWatch({
        handles,
        onExit: () => {
          evaluatorOpts.progressReporter.stop();
        },
      });
    } else {
      success = await runOnce(handles, evaluatorOpts);
    }
  } finally {
    // ESBuild can freeze up if you do not clean up the handles properly
    for (const handle of Object.values(handles)) {
      await handle.destroy();
    }
  }

  if (!success) {
    process.exit(1);
  }
}

function addAuthArgs(parser: ArgumentParser) {
  parser.add_argument("--api-key", {
    help: "Specify a braintrust api key. If the parameter is not specified, the BRAINTRUST_API_KEY environment variable will be used.",
  });
  parser.add_argument("--org-name", {
    help: "The name of a specific organization to connect to. This is useful if you belong to multiple.",
  });
  parser.add_argument("--app-url", {
    help: "Specify a custom braintrust app url. Defaults to https://www.braintrust.dev. This is only necessary if you are using an experimental version of Braintrust",
  });
  parser.add_argument("--env-file", {
    help: "A path to a .env file containing environment variables to load (via dotenv).",
  });
}

function addCompileArgs(parser: ArgumentParser) {
  parser.add_argument("--terminate-on-failure", {
    action: "store_true",
    help: "If provided, terminates on a failing eval, instead of the default (moving onto the next one).",
  });
  parser.add_argument("--tsconfig", {
    help: "Specify a custom tsconfig.json file to use.",
  });
}

async function main() {
  const parser = new ArgumentParser({
    description: "Braintrust CLI",
  });

  parser.add_argument("-v", "--version", { action: "version", version });

  const parentParser = new ArgumentParser({ add_help: false });
  parentParser.add_argument("--verbose", {
    action: "store_true",
    help: "Include additional details, including full stack traces on errors.",
  });

  const subparser = parser.add_subparsers({
    required: true,
  });

  const parser_run = subparser.add_parser("eval", {
    help: "Run evals locally.",
    parents: [parentParser],
  });
  addAuthArgs(parser_run);
  parser_run.add_argument("--filter", {
    help: "Only run evaluators that match these filters. Each filter is a regular expression (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp). For example, --filter metadata.priority='^P0$' input.name='foo.*bar' will only run evaluators that have metadata.priority equal to 'P0' and input.name matching the regular expression 'foo.*bar'.",
    nargs: "*",
  });
  parser_run.add_argument("--list", {
    help: "List, but do not execute, evaluators.",
    action: "store_true",
  });
  parser_run.add_argument("--jsonl", {
    action: "store_true",
    help: "Format score summaries as jsonl, i.e. one JSON-formatted line per summary.",
  });
  addCompileArgs(parser_run);
  parser_run.add_argument("--watch", {
    action: "store_true",
    help: "Watch files for changes and rerun evals when changes are detected",
  });
  parser_run.add_argument("--no-send-logs", {
    action: "store_true",
    help: "Do not send logs to Braintrust. Useful for testing evaluators without uploading results.",
  });
  parser_run.add_argument("--no-progress-bars", {
    action: "store_true",
    help: "Do not show progress bars when processing evaluators.",
  });
  parser_run.add_argument("--bundle", {
    action: "store_true",
    help: "Experimental (do not use unless you know what you're doing)",
  });
  parser_run.add_argument("--push", {
    action: "store_true",
    help: "Push the scorers from the current run to Braintrust. This will mark the current run's scorers as the latest version in the project.",
  });
  parser_run.add_argument("files", {
    nargs: "*",
    help: "A list of files or directories to run. If no files are specified, the current directory is used.",
  });
  parser_run.add_argument("--dev", {
    action: "store_true",
    help: "Run the evaluators in dev mode. This will start a dev server which you can connect to via the playground.",
  });
  parser_run.add_argument("--dev-host", {
    help: "The host to bind the dev server to. Defaults to localhost. Set to 0.0.0.0 to bind to all interfaces.",
    type: String,
    default: "localhost",
  });
  parser_run.add_argument("--dev-port", {
    help: "The port to bind the dev server to. Defaults to 8300.",
    type: Number,
    default: 8300,
  });
  parser_run.set_defaults({ func: run });

  const parser_push = subparser.add_parser("push", {
    help: "Bundle prompts, tools, scorers, and other resources into Braintrust",
  });
  addAuthArgs(parser_push);
  addCompileArgs(parser_push);
  parser_push.add_argument("files", {
    nargs: "*",
    help: "A list of files or directories containing functions to bundle. If no files are specified, the current directory is used.",
  });
  parser_push.add_argument("--if-exists", {
    choices: ["error", "replace", "ignore"],
    default: "error",
    help: "What to do if a function with the same slug already exists. 'error' will cause an error and abort. 'replace' will overwrite the existing function. 'ignore' will ignore the push for this function and continue.",
  });
  parser_push.set_defaults({ func: bundleCommand });

  const parser_pull = subparser.add_parser("pull", {
    help: "Pull prompts, tools, scorers, and other resources from Braintrust to save in your codebase.",
  });
  parser_pull.add_argument("--output-dir", {
    help: "The directory to output the pulled resources to. If not specified, the current directory is used.",
  });
  parser_pull.add_argument("--project-name", {
    help: "The name of the project to pull from. If not specified, all projects are pulled.",
  });
  parser_pull.add_argument("--project-id", {
    help: "The id of the project to pull from. If not specified, all projects are pulled.",
  });
  parser_pull.add_argument("--id", {
    help: "The id of a specific function to pull.",
  });
  parser_pull.add_argument("--slug", {
    help: "The slug of a specific function to pull.",
  });
  parser_pull.add_argument("--version", {
    help: "The version to pull. Will pull the latest version of each prompt that is at or before this version.",
  });
  parser_pull.add_argument("--force", {
    action: "store_true",
    help: "Overwrite local files if they have uncommitted changes.",
  });
  parser_pull.set_defaults({ func: pullCommand });

  const parsed = parser.parse_args();

  try {
    await parsed.func(parsed);
  } catch (e) {
    logError(e, parsed.verbose);
    process.exit(1);
  }
}

main();
