import {
  CodeBundle,
  FunctionObject,
  IfExists,
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
import { addAzureBlobHeaders, isEmpty } from "../util";
import { z } from "zod";
import { capitalize } from "@braintrust/core";
import { findCodeDefinition, makeSourceMapContext } from "./infer-source";
import slugifyLib from "slugify";
import { zodToJsonSchema } from "zod-to-json-schema";
import pluralize from "pluralize";
import { FunctionEvent, ProjectNameIdMap } from "../framework2";

export type EvaluatorMap = Record<
  string,
  {
    evaluator: EvaluatorState["evaluators"][number];
    experiment: Experiment;
  }
>;

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
  defaultIfExists,
}: {
  buildResults: BuildSuccess[];
  evalToExperiment?: Record<string, Record<string, Experiment>>;
  bundlePromises: {
    [k: string]: Promise<esbuild.BuildResult<esbuild.BuildOptions>>;
  };
  handles: Record<string, FileHandle>;
  verbose: boolean;
  setCurrent: boolean;
  defaultIfExists: IfExists;
}) {
  console.error(
    `Processing ${buildResults.length} ${pluralize("file", buildResults.length)}...`,
  );

  const projectNameToId = new ProjectNameIdMap();

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
        const project_id = await projectNameToId.resolve(fn.project);

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
        prompts.push(await prompt.toFunctionDefinition(projectNameToId));
      }
    }

    for (const evaluator of Object.values(result.evaluator.evaluators)) {
      const experiment =
        evalToExperiment?.[sourceFile]?.[evaluator.evaluator.evalName];

      const baseInfo = {
        project_id: experiment
          ? (await experiment.project).id
          : await projectNameToId.getId(evaluator.evaluator.projectName),
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
      defaultIfExists,
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
  defaultIfExists,
  verbose,
}: {
  sourceFile: string;
  prompts: FunctionEvent[];
  bundleSpecs: BundledFunctionSpec[];
  bundlePromises: {
    [k: string]: Promise<esbuild.BuildResult<esbuild.BuildOptions>>;
  };
  handles: Record<string, FileHandle>;
  defaultIfExists: IfExists;
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
  const bundleFileName = handles[sourceFile].bundleFile;
  if (!bundle || !bundleFileName) {
    return false;
  }

  const sourceMapContextPromise = makeSourceMapContext({
    inFile: sourceFile,
    outFile: bundleFileName,
    sourceMapFile: bundleFileName + ".map",
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

    const headers = {
      "Content-Encoding": "gzip",
    };
    addAzureBlobHeaders(headers, pathInfo.url);

    const resp = await fetch(pathInfo.url, {
      method: "PUT",
      body: bundleData,
      headers,
    });
    if (!resp.ok) {
      throw new Error(
        `Failed to upload bundle: ${resp.status} ${await resp.text()}`,
      );
    }
    return true;
  })();

  const sourceMapContext = await sourceMapContextPromise;

  // Insert the spec as prompt data
  const functionEntries: FunctionEvent[] = [
    ...prompts,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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
  ].map((fn) => ({
    ...fn,
    if_exists: fn.if_exists ?? defaultIfExists,
  }));

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
