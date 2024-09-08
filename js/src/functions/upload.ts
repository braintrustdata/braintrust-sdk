import {
  CodeBundle,
  functionDataSchema,
  FunctionObject,
} from "@braintrust/core/typespecs";
import { BuildSuccess, EvaluatorState, FileHandle } from "../cli";
import { scorerName, warning } from "../framework";
import { _internalGetGlobalState, Experiment } from "../logger";
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { createGzip } from "zlib";
import { isEmpty } from "../util";
import { z } from "zod";
import { capitalize } from "@braintrust/core";
import { findCodeDefinition, makeSourceMapContext } from "./infer-source";

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
  function_data: z.infer<typeof functionDataSchema>;
}

interface BundledFunctionSpec {
  project_id: string;
  name: string;
  slug: string;
  description: string;
  location: CodeBundle["location"];
  function_type: FunctionObject["function_type"];
  origin?: FunctionObject["origin"];
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
  console.error(`Processing bundles...`);

  const bundleSpecs: Record<string, BundledFunctionSpec[]> = {};

  const uploadPromises = buildResults.map(async (result) => {
    if (result.type !== "success") {
      return;
    }
    const sourceFile = result.sourceFile;

    if (!bundleSpecs[sourceFile]) {
      bundleSpecs[sourceFile] = [];
    }

    for (const evaluator of Object.values(result.evaluator.evaluators)) {
      const experiment =
        evalToExperiment?.[sourceFile]?.[evaluator.evaluator.evalName];

      // XXX NEXT STEPS:
      // - Figure out how to propagate project id in this case
      // - Try refactoring bundling code in the cli file to call into this
      const baseInfo = {
        project_id: experiment
          ? (await experiment.project).id
          : (() => {
              throw new Error("Cannot derive project id without experiment");
            })(),
      };

      const namePrefix = setCurrent
        ? evaluator.evaluator.experimentName
          ? `${evaluator.evaluator.experimentName}`
          : ""
        : experiment
          ? `${await experiment.name}`
          : "";

      const experimentId = experiment ? await experiment.id : undefined;

      const fileSpecs: BundledFunctionSpec[] = [
        {
          ...baseInfo,
          // There is a very small chance that someone names a function with the same convention, but
          // let's assume it's low enough that it doesn't matter.
          ...formatNameAndSlug(["experiment", namePrefix, "task"]),
          description: `Task for experiment ${namePrefix}`,
          location: {
            type: "experiment",
            eval_name: evaluator.evaluator.evalName,
            position: { type: "task" },
          },
          function_type: "task",
        },
        ...evaluator.evaluator.scores.map((score, i): BundledFunctionSpec => {
          const name = scorerName(score, i);
          return {
            ...baseInfo,
            // There is a very small chance that someone names a function with the same convention, but
            // let's assume it's low enough that it doesn't matter.
            ...formatNameAndSlug(["experiment", namePrefix, "scorer", name]),
            description: `Score ${name} for experiment ${namePrefix}`,
            location: {
              type: "experiment",
              eval_name: evaluator.evaluator.evalName,
              position: { type: "scorer", index: i },
            },
            function_type: "scorer",
            origin: experimentId
              ? {
                  object_type: "experiment",
                  object_id: experimentId,
                  internal: !setCurrent,
                }
              : undefined,
          };
        }),
      ];

      bundleSpecs[sourceFile].push(...fileSpecs);
    }
  });

  await Promise.all(uploadPromises);

  await uploadBundles({
    bundlePromises,
    bundleSpecs,
    handles,
    verbose,
  });
}

export async function uploadBundles({
  bundlePromises,
  bundleSpecs,
  handles,
  verbose,
}: {
  bundlePromises: {
    [k: string]: Promise<esbuild.BuildResult<esbuild.BuildOptions>>;
  };
  bundleSpecs: Record<string, BundledFunctionSpec[]>;
  handles: Record<string, FileHandle>;
  verbose: boolean;
}) {
  const uploadPromises = [];
  const orgId = _internalGetGlobalState().orgId;
  if (!orgId) {
    throw new Error("No organization ID found");
  }

  const loggerConn = _internalGetGlobalState().apiConn();
  let uploaded = 0;
  const runtime_context = {
    runtime: "node",
    version: process.version.slice(1),
  } as const;
  let failed = false;
  for (const [inFile, compileResult] of Object.entries(bundlePromises)) {
    uploadPromises.push(
      (async () => {
        const bundle = await compileResult;
        if (!bundle || !handles[inFile].bundleFile) {
          return;
        }

        const sourceMapContextPromise = makeSourceMapContext({
          inFile,
          outFile: handles[inFile].bundleFile,
          sourceMapFile: handles[inFile].bundleFile + ".map",
        });

        let pathInfo: z.infer<typeof pathInfoSchema>;
        try {
          pathInfo = pathInfoSchema.parse(
            await loggerConn.post_json("function/code", {
              org_id: orgId,
              runtime_context,
            }),
          );
        } catch (e) {
          failed = true;
          if (verbose) {
            console.error(e);
          }
          console.error(
            warning(
              `Unable to upload your code. You most likely need to update the API: ${e}`,
            ),
          );
          return;
        }

        // Upload bundleFile to pathInfo.url
        const bundleFileName = handles[inFile].bundleFile;
        if (isEmpty(bundleFileName)) {
          throw new Error("No bundle file found");
        }
        const bundleFile = path.resolve(bundleFileName);
        const uploadPromise = (async () => {
          const bundleStream = fs
            .createReadStream(bundleFile)
            .pipe(createGzip());
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
          uploaded += 1;
        })();

        const sourceMapContext = await sourceMapContextPromise;

        // Insert the spec as prompt data
        const functionEntries: FunctionEvent[] = await Promise.all(
          bundleSpecs[inFile].map(async (spec) => ({
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
                bundle_id: pathInfo.bundleId,
                preview: await findCodeDefinition({
                  location: spec.location,
                  ctx: sourceMapContext,
                }),
              },
            },
            origin: spec.origin,
            function_type: spec.function_type,
          })),
        );

        const logPromise = (async () => {
          try {
            await _internalGetGlobalState()
              .apiConn()
              .post_json("insert-functions", {
                functions: functionEntries,
              });
          } catch (e) {
            failed = true;
            if (verbose) {
              console.error(e);
            }
            console.warn(
              warning(
                `Failed to save function definitions for '${inFile}'. You most likely need to update the API: ${e}`,
              ),
            );
          }
        })();

        await Promise.all([uploadPromise, logPromise]);
      })(),
    );
  }

  await Promise.all(uploadPromises);
  console.error(
    `${uploaded} Bundle${uploaded > 1 ? "s" : ""} uploaded ${
      failed ? "with errors" : "successfully"
    }.`,
  );
}

function formatNameAndSlug(pieces: string[]) {
  const nonEmptyPieces = pieces.filter((piece) => piece.trim() !== "");
  return {
    name: capitalize(nonEmptyPieces.join(" ")),
    slug: nonEmptyPieces.join("-"),
  };
}
