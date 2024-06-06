import { CodeBundle, promptSchema } from "@braintrust/core/typespecs";
import { EvaluatorState, FileHandle } from "./cli";
import { scorerName, warning } from "./framework";
import { _internalGetGlobalState, Experiment, newId } from "./logger";
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { createGzip } from "zlib";
import { z } from "zod";
import { LazyValue } from "./util";
import { PromptEvent } from "@braintrust/core";

export type EvaluatorMap = Record<
  string,
  {
    evaluator: EvaluatorState["evaluators"][number];
    experiment: Experiment;
  }
>;

interface EvalFunction {
  project_id: string;
  name: string;
  slug: string;
  description: string;
  location: CodeBundle["location"];
}

export async function uploadEvalBundles({
  experimentIdToEvaluator,
  bundlePromises,
  handles,
}: {
  experimentIdToEvaluator: EvaluatorMap;
  bundlePromises: {
    [k: string]: Promise<esbuild.BuildResult<esbuild.BuildOptions> | undefined>;
  };
  handles: Record<string, FileHandle>;
}) {
  console.error(`Processing bundles...`);
  const uploadPromises = [];
  const orgId = _internalGetGlobalState().orgId;
  if (!orgId) {
    throw new Error("No organization ID found");
  }

  const bundleSpecs: Record<string, Record<string, EvalFunction[]>> = {};
  for (const [experimentId, evaluator] of Object.entries(
    experimentIdToEvaluator,
  )) {
    if (!bundleSpecs[evaluator.evaluator.sourceFile]) {
      bundleSpecs[evaluator.evaluator.sourceFile] = {};
    }
    const baseInfo = {
      project_id: (await evaluator.experiment.project).id, // This should resolve instantly
    };
    const namePrefix = `${await evaluator.experiment.name}`;
    bundleSpecs[evaluator.evaluator.sourceFile][experimentId] = [
      {
        ...baseInfo,
        // There is a very small chance that someone names a function with the same convention, but
        // let's assume it's low enough that it doesn't matter.
        name: `Eval ${namePrefix} task`,
        slug: `experiment-${namePrefix}-task`,
        description: `Task for experiment ${namePrefix}`,
        location: {
          type: "experiment",
          eval_name: evaluator.evaluator.evaluator.evalName,
          position: "task",
        },
      },
      ...evaluator.evaluator.evaluator.scores.map((score, i): EvalFunction => {
        const name = scorerName(score, i);
        return {
          ...baseInfo,
          // There is a very small chance that someone names a function with the same convention, but
          // let's assume it's low enough that it doesn't matter.
          name: `Eval ${namePrefix} scorer ${name}`,
          slug: `experiment-${namePrefix}-scorer-${name}`,
          description: `Score ${name} for experiment ${namePrefix}`,
          location: {
            type: "experiment",
            eval_name: evaluator.evaluator.evaluator.evalName,
            position: { score: i },
          },
        };
      }),
    ];
  }

  const loggerConn = _internalGetGlobalState().logConn();
  let uploaded = 0;
  const runtime_context = {
    runtime: "node",
    version: process.version.slice(1),
  } as const;
  for (const [inFile, compileResult] of Object.entries(bundlePromises)) {
    uploadPromises.push(
      (async () => {
        const bundle = await compileResult;
        if (!bundle || !handles[inFile].bundleFile) {
          return;
        }
        const spec = bundleSpecs[inFile];

        // XXX Zod this
        let pathInfo: {
          url: string;
          bundleId: string;
        };
        try {
          pathInfo = await loggerConn.post_json("register-code", {
            org_id: orgId,
            runtime_context,
          });
        } catch (e) {
          console.error(
            warning(
              `Unable to upload your code. You most likely need to update the API: ${e}`,
            ),
          );
          return;
        }

        // Upload bundleFile to pathInfo.url
        const bundleFile = path.resolve(handles[inFile].bundleFile);
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

        // Insert the spec as prompt data
        const promptEntries: PromptEvent[] = Object.values(bundleSpecs[inFile])
          .flatMap((specs) => specs)
          .map((spec) => ({
            id: newId(),
            project_id: spec.project_id,
            log_id: "p",
            name: spec.name,
            slug: spec.slug,
            description: spec.description,
            code_bundle: {
              runtime_context,
              location: spec.location,
              bundle_id: pathInfo.bundleId,
            },
          }));

        // XXX Fix this (probably by adding a new log type for prompts)
        const logger = _internalGetGlobalState().globalBgLogger();
        logger.log(promptEntries.map((e) => new LazyValue(async () => e)));
        const logPromise = logger.flush();

        await Promise.all([uploadPromise, logPromise]);
      })(),
    );
  }

  await Promise.all(uploadPromises);
  console.log(
    `${uploaded} Bundle${uploaded > 1 ? "s" : ""} uploaded successfully.`,
  );
}
