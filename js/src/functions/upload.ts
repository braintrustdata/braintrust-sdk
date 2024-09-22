import {
  CodeBundle,
  functionDataSchema,
  FunctionObject,
  IfExists,
  projectSchema,
  PromptData,
} from "@braintrust/core/typespecs";
import { BuildSuccess, EvaluatorState, FileHandle } from "../cli";
import { scorerName, warning } from "../framework";
import {
  _internalGetGlobalState,
  Experiment,
  FailedHTTPResponse,
} from "../logger";
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { createGzip } from "zlib";
import { isEmpty } from "../util";
import { z } from "zod";
import { capitalize } from "@braintrust/core";
import { findCodeDefinition, makeSourceMapContext } from "./infer-source";
import slugifyLib from "slugify";
import { zodToJsonSchema } from "zod-to-json-schema";
import pluralize from "pluralize";

export type EvaluatorMap = Record<
  string,
  {
    evaluator: EvaluatorState["evaluators"][number];
    experiment: Experiment;
  }
>;

interface FunctionEvent {
  project_id: string;
  slug: string;
  name: string;
  description: string;
  prompt_data?: PromptData;
  function_data: z.infer<typeof functionDataSchema>;
  if_exists?: IfExists;
}

interface BundledFunctionSpec {
  project_id: string;
  name: string;
  slug: string;
  description: string;
  location: CodeBundle["location"];
  function_type: FunctionObject["function_type"];
  origin?: FunctionObject["origin"];
  function_schema?: FunctionObject["function_schema"];
  if_exists?: IfExists;
}

const pathInfoSchema = z
  .strictObject({
    url: z.string(),
    bundleId: z.string(),
  })
  .strip();

export async function uploadHandleBundles({
  buildResults,
  evalToExperiment,
  bundlePromises,
  handles,
  setCurrent,
  verbose,
}: {
  buildResults: BuildSuccess[];
  evalToExperiment?: Record<string, Record<string, Experiment>>;
  bundlePromises: {
    [k: string]: Promise<esbuild.BuildResult<esbuild.BuildOptions>>;
  };
  handles: Record<string, FileHandle>;
  verbose: boolean;
  setCurrent: boolean;
}) {
  console.error(
    `Processing ${buildResults.length} ${pluralize("file", buildResults.length)}...`,
  );

  const projectNameToId: Record<string, Promise<string>> = {};
  const getProjectId = async (projectName: string) => {
    if (!projectNameToId[projectName]) {
      projectNameToId[projectName] = loadProjectId(projectName);
    }
    return projectNameToId[projectName];
  };

  const uploadPromises = buildResults.map(async (result) => {
    if (result.type !== "success") {
      return;
    }
    const sourceFile = result.sourceFile;

    const bundleSpecs: BundledFunctionSpec[] = [];
    const prompts: FunctionEvent[] = [];

    if (setCurrent) {
      for (let i = 0; i < result.evaluator.functions.length; i++) {
        const fn = result.evaluator.functions[i];
        let project_id = fn.project.id;
        if (!project_id) {
          if (!fn.project.name) {
            throw new Error("Tool project not found");
          }
          project_id = await getProjectId(fn.project.name);
        }

        bundleSpecs.push({
          project_id: project_id,
          name: fn.name,
          slug: fn.slug,
          description: fn.description ?? "",
          function_type: fn.type,
          location: {
            type: "function",
            index: i,
          },
          function_schema:
            fn.parameters || fn.returns
              ? {
                  parameters: fn.parameters
                    ? zodToJsonSchema(fn.parameters)
                    : undefined,
                  returns: fn.returns ? zodToJsonSchema(fn.returns) : undefined,
                }
              : undefined,
          if_exists: fn.ifExists,
        });
      }

      for (const prompt of result.evaluator.prompts) {
        let project_id = prompt.project.id;
        if (!project_id) {
          if (!prompt.project.name) {
            throw new Error("Prompt project not found");
          }
          project_id = await getProjectId(prompt.project.name);
        }

        prompts.push({
          project_id,
          name: prompt.name,
          slug: prompt.slug,
          description: prompt.description ?? "",
          function_data: {
            type: "prompt",
          },
          prompt_data: prompt.prompt,
          if_exists: prompt.ifExists,
        });
      }
    }

    for (const evaluator of Object.values(result.evaluator.evaluators)) {
      const experiment =
        evalToExperiment?.[sourceFile]?.[evaluator.evaluator.evalName];

      const baseInfo = {
        project_id: experiment
          ? (await experiment.project).id
          : await getProjectId(evaluator.evaluator.projectName),
      };

      const namePrefix = setCurrent
        ? evaluator.evaluator.experimentName
          ? `${evaluator.evaluator.experimentName}`
          : evaluator.evaluator.evalName
        : experiment
          ? `${await experiment.name}`
          : evaluator.evaluator.evalName;

      const experimentId = experiment ? await experiment.id : undefined;
      const origin: FunctionObject["origin"] = experimentId
        ? {
            object_type: "experiment",
            object_id: experimentId,
            internal: !setCurrent,
          }
        : undefined;

      const fileSpecs: BundledFunctionSpec[] = [
        {
          ...baseInfo,
          // There is a very small chance that someone names a function with the same convention, but
          // let's assume it's low enough that it doesn't matter.
          ...formatNameAndSlug(["eval", namePrefix, "task"]),
          description: `Task for eval ${namePrefix}`,
          location: {
            type: "experiment",
            eval_name: evaluator.evaluator.evalName,
            position: { type: "task" },
          },
          function_type: "task",
          origin,
        },
        ...evaluator.evaluator.scores.map((score, i): BundledFunctionSpec => {
          const name = scorerName(score, i);
          return {
            ...baseInfo,
            // There is a very small chance that someone names a function with the same convention, but
            // let's assume it's low enough that it doesn't matter.
            ...formatNameAndSlug(["eval", namePrefix, "scorer", name]),
            description: `Score ${name} for eval ${namePrefix}`,
            location: {
              type: "experiment",
              eval_name: evaluator.evaluator.evalName,
              position: { type: "scorer", index: i },
            },
            function_type: "scorer",
            origin,
          };
        }),
      ];

      bundleSpecs.push(...fileSpecs);
    }

    const slugs: Set<string> = new Set();
    for (const spec of bundleSpecs) {
      if (slugs.has(spec.slug)) {
        throw new Error(`Duplicate slug: ${spec.slug}`);
      }
      slugs.add(spec.slug);
    }
    for (const prompt of prompts) {
      if (slugs.has(prompt.slug)) {
        throw new Error(`Duplicate slug: ${prompt.slug}`);
      }
      slugs.add(prompt.slug);
    }

    return await uploadBundles({
      sourceFile,
      prompts,
      bundleSpecs,
      bundlePromises,
      handles,
      verbose,
    });
  });

  const uploadResults = await Promise.all(uploadPromises);
  const numUploaded = uploadResults.length;
  const numFailed = uploadResults.filter((result) => !result).length;

  console.error(
    `${numUploaded} ${pluralize("file", numUploaded)} uploaded ${
      numFailed > 0
        ? `with ${numFailed} error${numFailed > 1 ? "s" : ""}`
        : "successfully"
    }.`,
  );

  return {
    numTotal: buildResults.length,
    numUploaded,
    numFailed,
  };
}

async function uploadBundles({
  sourceFile,
  prompts,
  bundleSpecs,
  bundlePromises,
  handles,
  verbose,
}: {
  sourceFile: string;
  prompts: FunctionEvent[];
  bundleSpecs: BundledFunctionSpec[];
  bundlePromises: {
    [k: string]: Promise<esbuild.BuildResult<esbuild.BuildOptions>>;
  };
  handles: Record<string, FileHandle>;
  verbose: boolean;
}): Promise<boolean> {
  const orgId = _internalGetGlobalState().orgId;
  if (!orgId) {
    throw new Error("No organization ID found");
  }

  const loggerConn = _internalGetGlobalState().apiConn();
  const runtime_context = {
    runtime: "node",
    version: process.version.slice(1),
  } as const;

  const bundle = await bundlePromises[sourceFile];
  if (!bundle || !handles[sourceFile].bundleFile) {
    return false;
  }

  const sourceMapContextPromise = makeSourceMapContext({
    inFile: sourceFile,
    outFile: handles[sourceFile].bundleFile,
    sourceMapFile: handles[sourceFile].bundleFile + ".map",
  });

  let pathInfo: z.infer<typeof pathInfoSchema> | undefined = undefined;
  if (bundleSpecs.length > 0) {
    try {
      pathInfo = pathInfoSchema.parse(
        await loggerConn.post_json("function/code", {
          org_id: orgId,
          runtime_context,
        }),
      );
    } catch (e) {
      if (verbose) {
        console.error(e);
      }
      const msg =
        e instanceof FailedHTTPResponse
          ? `Unable to upload your code. ${e.status} (${e.text}): ${e.data}`
          : `Unable to upload your code. You most likely need to update the API: ${e}`;
      console.error(warning(msg));
      return false;
    }
  }

  // Upload bundleFile to pathInfo.url
  const bundleFileName = handles[sourceFile].bundleFile;
  if (isEmpty(bundleFileName)) {
    throw new Error("No bundle file found");
  }
  const bundleFile = path.resolve(bundleFileName);
  const uploadPromise = (async (): Promise<boolean> => {
    if (!pathInfo) {
      return true;
    }
    const bundleStream = fs.createReadStream(bundleFile).pipe(createGzip());
    const bundleData = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      bundleStream.on("data", (chunk) => {
        chunks.push(chunk);
      });
      bundleStream.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
      bundleStream.on("error", reject);
    });

    await fetch(pathInfo.url, {
      method: "PUT",
      body: bundleData,
      headers: {
        "Content-Encoding": "gzip",
      },
    });
    return true;
  })();

  const sourceMapContext = await sourceMapContextPromise;

  // Insert the spec as prompt data
  const functionEntries: FunctionEvent[] = [
    ...prompts,
    ...((await Promise.all(
      bundleSpecs.map(async (spec) => ({
        project_id: spec.project_id,
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        function_data: {
          type: "code",
          data: {
            type: "bundle",
            runtime_context,
            location: spec.location,
            bundle_id: pathInfo!.bundleId,
            preview: await findCodeDefinition({
              location: spec.location,
              ctx: sourceMapContext,
            }),
          },
        },
        origin: spec.origin,
        function_type: spec.function_type,
        function_schema: spec.function_schema,
        if_exists: spec.if_exists,
      })),
    )) as FunctionEvent[]),
  ];

  const logPromise = (async (): Promise<boolean> => {
    try {
      await _internalGetGlobalState().apiConn().post_json("insert-functions", {
        functions: functionEntries,
      });
    } catch (e) {
      if (verbose) {
        console.error(e);
      }
      const msg =
        e instanceof FailedHTTPResponse
          ? `Failed to save function definitions for '${sourceFile}'. ${e.status} (${e.text}): ${e.data}`
          : `Failed to save function definitions for '${sourceFile}'. You most likely need to update the API: ${e}`;
      console.warn(warning(msg));
      return false;
    }
    return true;
  })();

  const [uploadSuccess, logSuccess] = await Promise.all([
    uploadPromise,
    logPromise,
  ]);

  return uploadSuccess && logSuccess;
}

function formatNameAndSlug(pieces: string[]) {
  const nonEmptyPieces = pieces.filter((piece) => piece.trim() !== "");
  return {
    name: capitalize(nonEmptyPieces.join(" ")),
    slug: slugifyLib(nonEmptyPieces.join("-")),
  };
}

async function loadProjectId(projectName: string): Promise<string> {
  const response = await _internalGetGlobalState()
    .appConn()
    .post_json("api/project/register", {
      project_name: projectName,
    });

  const result = z
    .object({
      project: projectSchema,
    })
    .parse(response);

  return result.project.id;
}
