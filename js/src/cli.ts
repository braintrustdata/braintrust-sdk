#!/usr/bin/env node

import * as esbuild from "esbuild";
import * as dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path, { dirname } from "path";
import util from "util";
import * as fsWalk from "@nodelib/fs.walk";
import { minimatch } from "minimatch";
import { ArgumentParser } from "argparse";
import { v4 as uuidv4 } from "uuid";
import pluralize from "pluralize";
import {
  login,
  init as initExperiment,
  _internalGetGlobalState,
  Experiment,
} from "./logger";
import {
  BarProgressReporter,
  SimpleProgressReporter,
  ProgressReporter,
} from "./progress";

// Re-use the module resolution logic from Jest
import nodeModulesPaths from "./jest/nodeModulesPaths";
import {
  EvaluatorDef,
  EvaluatorFile,
  Filter,
  ReporterDef,
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
import { uploadEvalBundles } from "./functions";

// This requires require
// https://stackoverflow.com/questions/50822310/how-to-import-package-json-in-typescript
const { version } = require("../package.json");

// TODO: This could be loaded from configuration
const INCLUDE = [
  "**/*.eval.ts",
  "**/*.eval.tsx",
  "**/*.eval.js",
  "**/*.eval.jsx",
];
const EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/build/**"];
const OUT_EXT = "js";

configureNode();

interface BuildSuccess {
  type: "success";
  result: esbuild.BuildResult;
  evaluator: EvaluatorFile;
  sourceFile: string;
}

interface BuildFailure {
  type: "failure";
  error: Error;
  sourceFile: string;
}

type BuildResult = BuildSuccess | BuildFailure;
export interface FileHandle {
  inFile: string;
  outFile: string;
  bundleFile?: string;
  rebuild: () => Promise<BuildResult>;
  bundle: () => Promise<esbuild.BuildResult>;
  watch: () => void;
  destroy: () => Promise<void>;
}

function evalWithModuleContext<T>(inFile: string, evalFn: () => T): T {
  const modulePaths = [...module.paths];
  try {
    module.paths = nodeModulesPaths(path.dirname(inFile), {});
    return evalFn();
  } finally {
    module.paths = modulePaths;
  }
}

function evaluateBuildResults(
  inFile: string,
  buildResult: esbuild.BuildResult,
): EvaluatorFile | null {
  if (!buildResult.outputFiles) {
    return null;
  }
  const moduleText = buildResult.outputFiles[0].text;
  return evalWithModuleContext(inFile, () => {
    globalThis._evals = {
      evaluators: {},
      reporters: {},
    };
    globalThis._lazy_load = true;
    globalThis.__inherited_braintrust_state = _internalGetGlobalState();
    const __filename = inFile;
    const __dirname = dirname(__filename);
    new Function("require", "__filename", "__dirname", moduleText)(
      require,
      __filename,
      __dirname,
    );
    return { ...globalThis._evals };
  });
}

async function initLogger(
  projectName: string,
  experimentName?: string,
  metadata?: Record<string, unknown>,
) {
  const logger = initExperiment(projectName, {
    experiment: experimentName,
    metadata,
  });
  const info = await logger.summarize({ summarizeScores: false });
  console.error(
    `Experiment ${info.experimentName} is running at ${info.experimentUrl}`,
  );
  return logger;
}

function resolveReporter(
  reporter: string | ReporterDef<any> | undefined,
  reporters: Record<string, ReporterDef<any>>,
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
    reporter: ReporterDef<any>;
    results: (any | Promise<any>)[];
  }
>;

function addReport(
  evalReports: AllReports,
  reporter: ReporterDef<any>,
  report: any,
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
            evaluator: evaluator.evaluator,
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
            reporter: ReporterDef<any>;
            results: any[];
          }
        > = {};
        for (const evaluatorDef of Object.values(evalResult.evaluators)) {
          const { evaluator, reporter } = evaluatorDef;
          const logger = opts.noSendLogs
            ? null
            : await initLogger(
                evaluator.projectName,
                evaluator.experimentName,
                evaluator.metadata,
              );
          const evaluatorResult = await runEvaluator(
            logger,
            evaluator,
            opts.progressReporter,
            opts.filters,
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
  opts,
  args,
}: {
  inFile: string;
  outFile: string;
  bundleFile: string;
  opts: EvaluatorOpts;
  args: RunArgs;
}): Promise<FileHandle> {
  const buildOptions = buildOpts(inFile, outFile, opts, args);
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
          evaluators: {},
          reporters: {},
        };
        return { type: "success", result, evaluator, sourceFile: inFile };
      } catch (e) {
        return { type: "failure", error: e as Error, sourceFile: inFile };
      }
    },
    bundle: async () => {
      const buildOptions: esbuild.BuildOptions = {
        ...buildOpts(inFile, bundleFile, opts, args),
        external: [],
        write: true,
        plugins: [],
        minify: true,
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
    evaluator: EvaluatorDef<any, any, any, any>;
    reporter: string | ReporterDef<any> | undefined;
  }[];
  reporters: {
    [reporter: string]: ReporterDef<any>;
  };
}

interface EvaluatorOpts {
  verbose: boolean;
  apiKey?: string;
  orgName?: string;
  appUrl?: string;
  noSendLogs: boolean;
  bundle: boolean;
  terminateOnFailure: boolean;
  watch: boolean;
  list: boolean;
  jsonl: boolean;
  filters: Filter[];
  progressReporter: ProgressReporter;
}

function updateEvaluators(
  evaluators: EvaluatorState,
  buildResults: BuildResult[],
  opts: EvaluatorOpts,
) {
  for (const result of buildResults) {
    if (result.type === "failure") {
      if (opts.terminateOnFailure) {
        throw result.error;
      } else if (opts.verbose) {
        console.warn(`Failed to compile ${result.sourceFile}`);
        console.warn(result.error);
      } else {
        console.warn(
          `Failed to compile ${result.sourceFile}: ${result.error.message}`,
        );
      }
      continue;
    }

    for (const evaluator of Object.values(result.evaluator.evaluators)) {
      evaluators.evaluators.push({
        sourceFile: result.sourceFile,
        evaluator: evaluator.evaluator,
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

async function runAndWatch(
  handles: Record<string, FileHandle>,
  opts: EvaluatorOpts,
) {
  const count = Object.keys(handles).length;
  console.error(`Watching ${pluralize("file", count, true)}...`);

  Object.values(handles).map((handle) => handle.watch());

  ["SIGINT", "SIGTERM"].forEach((signal: string) => {
    process.on(signal, function () {
      console.error("Stopped watching.");
      for (const handle of Object.values(handles)) {
        handle.destroy();
      }
      opts.progressReporter.stop();
      process.exit(0);
    });
  });

  // Wait forever while we watch.
  await new Promise(() => {});
}

async function runOnce(
  handles: Record<string, FileHandle>,
  opts: EvaluatorOpts,
) {
  const buildPromises = Object.values(handles).map((handle) =>
    handle.rebuild(),
  );

  const buildResults = await Promise.all(buildPromises);

  const bundlePromises = opts.bundle
    ? Object.fromEntries(
        Object.entries(handles).map(([inFile, handle]) => [
          inFile,
          handle.bundle(),
        ]),
      )
    : null;

  const evaluators: EvaluatorState = {
    evaluators: [],
    reporters: {},
  };
  updateEvaluators(evaluators, buildResults, opts);

  if (opts.list) {
    for (const evaluator of evaluators.evaluators) {
      console.log(evaluator.evaluator.evalName);
    }
    return true;
  }

  const experimentIdToEvaluator: Record<
    string,
    {
      evaluator: EvaluatorState["evaluators"][number];
      experiment: Experiment;
    }
  > = {};
  const resultPromises = evaluators.evaluators.map(async (evaluator) => {
    // TODO: For now, use the eval name as the project. However, we need to evolve
    // the definition of a project and create a new concept called run, so that we
    // can name the experiment/evaluation within the run the evaluator's name.
    const logger = opts.noSendLogs
      ? null
      : await initLogger(
          evaluator.evaluator.projectName,
          evaluator.evaluator.experimentName,
          evaluator.evaluator.metadata,
        );
    try {
      return await runEvaluator(
        logger,
        evaluator.evaluator,
        opts.progressReporter,
        opts.filters,
      );
    } finally {
      if (logger) {
        experimentIdToEvaluator[await logger.id] = {
          evaluator,
          experiment: logger,
        };
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
      reporter: ReporterDef<any>;
      results: [];
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
      allEvalsResults[idx as number],
      {
        verbose: opts.verbose,
        jsonl: opts.jsonl,
      },
    );

    addReport(evalReports, resolvedReporter, report);
  }

  if (
    bundlePromises !== null &&
    Object.entries(experimentIdToEvaluator).length > 0
  ) {
    const bundleSpecs: Record<string, Record<string, string>> = {};
    for (const [experimentId, evaluator] of Object.entries(
      experimentIdToEvaluator,
    )) {
      if (!bundleSpecs[evaluator.evaluator.sourceFile]) {
        bundleSpecs[evaluator.evaluator.sourceFile] = {};
      }
      bundleSpecs[evaluator.evaluator.sourceFile][experimentId] =
        evaluator.evaluator.evaluator.evalName;
    }

    await uploadEvalBundles({
      experimentIdToEvaluator,
      bundlePromises,
      handles,
      verbose: opts.verbose,
    });
  }

  let allSuccess = true;
  for (const [reporterName, { reporter, results }] of Object.entries(
    evalReports,
  )) {
    const success = await reporter.reportRun(await Promise.all(results));
    allSuccess = allSuccess && success;
  }

  return allSuccess;
}

interface RunArgs {
  files: string[];
  watch: boolean;
  list: boolean;
  jsonl: boolean;
  verbose: boolean;
  api_key?: string;
  org_name?: string;
  app_url?: string;
  filter?: string[];
  tsconfig?: string;
  no_send_logs: boolean;
  no_progress_bars: boolean;
  terminate_on_failure: boolean;
  bundle: boolean;
  env_file?: string;
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

async function collectFiles(inputPath: string): Promise<string[]> {
  let pathStat = null;
  try {
    pathStat = fs.lstatSync(inputPath);
  } catch (e) {
    console.error(error(`Error reading ${inputPath}: ${e}`));
    process.exit(1);
  }

  let files: string[] = [];
  if (!pathStat.isDirectory()) {
    if (!checkMatch(inputPath, INCLUDE, EXCLUDE)) {
      console.warn(
        warning(
          `Reading ${inputPath} because it was specified directly. Rename it to end in .eval.ts or ` +
            `.eval.js to include it automatically when you specify a directory.`,
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
          entry.dirent.isFile() && checkMatch(entry.path, INCLUDE, EXCLUDE)
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
let markOurPackagesExternalPlugin = {
  name: "make-all-packages-external",
  setup(build: esbuild.PluginBuild) {
    const filter = /^(\w)/;
    build.onResolve({ filter }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

function buildOpts(
  fileName: string,
  outFile: string,
  opts: EvaluatorOpts,
  args: RunArgs,
): esbuild.BuildOptions {
  const plugins = [markOurPackagesExternalPlugin];
  if (opts.watch) {
    plugins.push(buildWatchPluginForEvaluator(fileName, opts));
  }
  return {
    entryPoints: [fileName],
    bundle: true,
    treeShaking: true,
    outfile: outFile,
    platform: "node",
    write: false,
    // Remove the leading "v" from process.version
    target: `node${process.version.slice(1)}`,
    tsconfig: args.tsconfig,
    external: ["node_modules/*"],
    plugins: plugins,
  };
}

async function initializeHandles(args: RunArgs, opts: EvaluatorOpts) {
  const files: Record<string, boolean> = {};
  const inputPaths = args.files.length > 0 ? args.files : ["."];
  for (const inputPath of inputPaths) {
    const newFiles = await collectFiles(inputPath);
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

  let tmpDir = path.join(os.tmpdir(), `btevals-${uuidv4().slice(0, 8)}`);
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
      initFile({ inFile: file, outFile, opts, bundleFile, args }),
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
    bundle: !!args.bundle,
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

  const handles = await initializeHandles(args, evaluatorOpts);

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
      await runAndWatch(handles, evaluatorOpts);
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

async function main() {
  const [, ...args] = process.argv;

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
  parser_run.add_argument("--api-key", {
    help: "Specify a braintrust api key. If the parameter is not specified, the BRAINTRUST_API_KEY environment variable will be used.",
  });
  parser_run.add_argument("--org-name", {
    help: "The name of a specific organization to connect to. This is useful if you belong to multiple.",
  });
  parser_run.add_argument("--app-url", {
    help: "Specify a custom braintrust app url. Defaults to https://www.braintrust.dev. This is only necessary if you are using an experimental version of Braintrust",
  });
  parser_run.add_argument("--watch", {
    action: "store_true",
    help: "Watch files for changes and rerun evals when changes are detected",
  });
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
  parser_run.add_argument("--tsconfig", {
    help: "Specify a custom tsconfig.json file to use.",
  });
  parser_run.add_argument("--no-send-logs", {
    action: "store_true",
    help: "Do not send logs to Braintrust. Useful for testing evaluators without uploading results.",
  });
  parser_run.add_argument("--no-progress-bars", {
    action: "store_true",
    help: "Do not show progress bars when processing evaluators.",
  });
  parser_run.add_argument("--terminate-on-failure", {
    action: "store_true",
    help: "If provided, terminates on a failing eval, instead of the default (moving onto the next one).",
  });
  parser_run.add_argument("--bundle", {
    action: "store_true",
    help: "Experimental (do not use unless you know what you're doing)",
  });
  parser_run.add_argument("--env-file", {
    help: "A path to a .env file containing environment variables to load (via dotenv).",
  });
  parser_run.add_argument("files", {
    nargs: "*",
    help: "A list of files or directories to run. If no files are specified, the current directory is used.",
  });
  parser_run.set_defaults({ func: run });

  const parsed = parser.parse_args();

  try {
    await parsed.func(parsed);
  } catch (e) {
    logError(e, parsed.verbose);
    process.exit(1);
  }
}

main();
