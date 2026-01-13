import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import {
  callEvaluatorData,
  Eval,
  EvalData,
  EvalHooks,
  EvalScorer,
  EvaluatorDef,
  OneOrMoreScores,
  scorerName,
} from "../src/framework";
import { errorHandler } from "./errorHandler";
import {
  authorizeRequest,
  baseAllowedHeaders,
  makeCheckAuthorized,
  checkOrigin,
} from "./authorize";
import {
  type FunctionIdType as FunctionId,
  type InvokeFunctionType as InvokeFunctionRequest,
  type RunEvalType as RunEvalRequest,
  type SSEProgressEventDataType as SSEProgressEventData,
} from "../src/generated_types";
import {
  BaseMetadata,
  BraintrustState,
  Config,
  EvalCase,
  getSpanParentObject,
  initDataset,
} from "../src/logger";
import {
  BT_CURSOR_HEADER,
  BT_FOUND_EXISTING_HEADER,
  parseParent,
} from "../util/index";
import { serializeSSEEvent } from "./stream";
import {
  evalBodySchema,
  EvaluatorDefinitions,
  EvaluatorManifest,
  evalParametersSerializedSchema,
} from "./types";
import { EvalParameters, validateParameters } from "../src/eval-parameters";
import { z } from "zod/v3";
import { promptDefinitionToPromptData } from "../src/framework2";
import { zodToJsonSchema } from "../src/zod/utils";

// Check if a value looks like a Zod schema
function isZodSchema(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  // Zod schemas have specific internal properties
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = value as any;
  return (
    "_def" in v || // Zod v3
    "_zod" in v || // Zod v4
    (typeof v.parse === "function" && typeof v.safeParse === "function")
  );
}

export interface DevServerOpts {
  host: string;
  port: number;
  orgName?: string;
}

export function runDevServer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluators: EvaluatorDef<any, any, any, any, any>[],
  opts: DevServerOpts,
) {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const allEvaluators: EvaluatorManifest = Object.fromEntries(
    evaluators.map((evaluator) => [evaluator.evalName, evaluator]),
  ) as EvaluatorManifest;

  globalThis._lazy_load = false;

  const app = express();

  app.use(express.json({ limit: "1gb" }));
  console.log("Starting server");
  app.use((req, res, next) => {
    if (req.headers["access-control-request-private-network"]) {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    next();
  });

  const checkAuthorized = makeCheckAuthorized(opts.orgName);

  app.use(
    cors({
      origin: checkOrigin,
      methods: ["GET", "PATCH", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: baseAllowedHeaders,
      credentials: true,
      exposedHeaders: [
        BT_CURSOR_HEADER,
        BT_FOUND_EXISTING_HEADER,
        "x-bt-span-id",
        "x-bt-span-export",
      ],
      maxAge: 86400,
    }),
  );

  app.use(authorizeRequest);

  app.get("/", (req, res) => {
    res.send("Hello, world!");
  });

  // List endpoint - returns all available evaluators and their metadata
  app.get(
    "/list",
    checkAuthorized,
    asyncHandler(async (req, res) => {
      const evalDefs: EvaluatorDefinitions = Object.fromEntries(
        await Promise.all(
          Object.entries(allEvaluators).map(async ([name, evaluator]) => {
            // Await parameters if it's a Promise (e.g. from loadConfig)
            const resolvedParameters = await Promise.resolve(
              evaluator.parameters,
            );

            // Check if parameters come from loadConfig (Config)
            const configSource = Config.isConfig(resolvedParameters)
              ? {
                  configId: resolvedParameters.configId,
                  slug: resolvedParameters.slug,
                  name: resolvedParameters.name,
                  projectId: resolvedParameters.projectId,
                  projectName: resolvedParameters.projectName,
                  version: resolvedParameters.version,
                  environment: resolvedParameters.environment,
                }
              : undefined;

            return [
              name,
              {
                parameters: resolvedParameters
                  ? makeEvalParametersSchema(resolvedParameters)
                  : undefined,
                configSource,
                scores: evaluator.scores.map((score, idx) => ({
                  name: scorerName(score, idx),
                })),
              },
            ];
          }),
        ),
      );
      res.json(evalDefs);
    }),
  );

  app.post(
    "/eval",
    checkAuthorized,
    asyncHandler(async (req, res) => {
      const {
        name,
        parameters,
        parent,
        experiment_name,
        project_id,
        data,
        scores,
        stream,
      } = evalBodySchema.parse(req.body);

      if (!req.ctx?.state) {
        res
          .status(500)
          .json({ error: "Braintrust state not initialized in request" });
        return;
      }
      const state = req.ctx.state;

      const evaluator = allEvaluators[name];
      if (!evaluator) {
        res.status(404).json({ error: `Evaluator '${name}' not found` });
        return;
      }

      // Await parameters if it's a Promise (e.g. from loadConfig)
      const resolvedEvaluatorParameters = await Promise.resolve(
        evaluator.parameters,
      );

      // Check if parameters are Zod schemas (need validation) or raw values (from loadConfig)
      const hasZodSchemas =
        resolvedEvaluatorParameters &&
        Object.values(resolvedEvaluatorParameters).some((v) => isZodSchema(v));

      if (
        hasZodSchemas &&
        resolvedEvaluatorParameters &&
        Object.keys(resolvedEvaluatorParameters).length > 0
      ) {
        try {
          // This gets done again in the framework, but we do it here too to give a
          // better error message.
          validateParameters(parameters ?? {}, resolvedEvaluatorParameters);
        } catch (e) {
          console.error("Error validating parameters", e);
          if (e instanceof z.ZodError || e instanceof Error) {
            res.status(400).json({
              error: e.message,
            });
            return;
          }
          throw e;
        }
      }

      const resolvedData = await getDataset(state, data);
      const evalData = callEvaluatorData(resolvedData);
      console.log("Starting eval", evaluator.evalName);

      // Set up SSE headers
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
      } else {
        res.setHeader("Content-Type", "application/json");
      }

      const task = async (
        input: unknown,
        hooks: EvalHooks<unknown, BaseMetadata, Record<string, unknown>>,
      ) => {
        const result = await evaluator.task(input, hooks);

        hooks.reportProgress({
          format: "code",
          output_type: "completion",
          event: "json_delta",
          data: JSON.stringify(result),
        });
        return result;
      };

      try {
        const summary = await Eval(
          "worker-thread",
          {
            ...evaluator,
            data: evalData.data,
            scores: evaluator.scores.concat(
              scores?.map((score) =>
                makeScorer(
                  state,
                  score.name,
                  score.function_id,
                  req.ctx?.projectId,
                ),
              ) ?? [],
            ),
            task,
            state,
            experimentName: experiment_name ?? undefined,
            projectId: project_id ?? undefined,
          },
          {
            // Avoid printing the bar to the console.
            progress: {
              start: () => {},
              stop: () => {
                console.log("Finished running experiment");
              },
              increment: () => {},
            },
            stream: (data: SSEProgressEventData) => {
              if (stream) {
                res.write(
                  serializeSSEEvent({
                    event: "progress",
                    data: JSON.stringify(data),
                  }),
                );
              }
            },
            onStart: (metadata) => {
              if (stream) {
                res.write(
                  serializeSSEEvent({
                    event: "start",
                    data: JSON.stringify(metadata),
                  }),
                );
              }
            },
            parent: parseParent(parent),
            parameters: parameters ?? {},
          },
        );

        if (stream) {
          res.write(
            serializeSSEEvent({
              event: "summary",
              data: JSON.stringify(summary.summary),
            }),
          );
          res.write(
            serializeSSEEvent({
              event: "done",
              data: "",
            }),
          );
        } else {
          res.json(summary.summary);
        }
      } catch (e) {
        console.error("Error running eval", e);
        if (stream) {
          res.write(
            serializeSSEEvent({
              event: "error",
              data: JSON.stringify(e),
            }),
          );
        } else {
          res.status(500).json({ error: e });
        }
      } finally {
        res.end();
      }
    }),
  );

  app.use(errorHandler);

  // Start the server
  app.listen(opts.port, opts.host, () => {
    console.log(`Dev server running at http://${opts.host}:${opts.port}`);
  });
}
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

async function getDataset(
  state: BraintrustState,
  data: RunEvalRequest["data"],
): Promise<EvalData<unknown, unknown, BaseMetadata>> {
  if ("project_name" in data) {
    return initDataset({
      state,
      project: data.project_name,
      dataset: data.dataset_name,
      _internal_btql: data._internal_btql ?? undefined,
    });
  } else if ("dataset_id" in data) {
    const datasetInfo = await getDatasetById({
      state,
      datasetId: data.dataset_id,
    });
    return initDataset({
      state,
      projectId: datasetInfo.projectId,
      dataset: datasetInfo.dataset,
      _internal_btql: data._internal_btql ?? undefined,
    });
  } else {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return data.data as EvalCase<unknown, unknown, BaseMetadata>[];
  }
}

const datasetFetchSchema = z.object({
  project_id: z.string(),
  name: z.string(),
});
async function getDatasetById({
  state,
  datasetId,
}: {
  state: BraintrustState;
  datasetId: string;
}): Promise<{ projectId: string; dataset: string }> {
  const dataset = await state.appConn().post_json("api/dataset/get", {
    id: datasetId,
  });
  const parsed = z.array(datasetFetchSchema).parse(dataset);
  if (parsed.length === 0) {
    throw new Error(`Dataset '${datasetId}' not found`);
  }
  return { projectId: parsed[0].project_id, dataset: parsed[0].name };
}

function makeScorer(
  state: BraintrustState,
  name: string,
  score: FunctionId,
  projectId: string | undefined,
): EvalScorer<unknown, unknown, unknown, BaseMetadata> {
  const ret = async (input: EvalCase<unknown, unknown, BaseMetadata>) => {
    const request: InvokeFunctionRequest = {
      ...score,
      input,
      parent: await getSpanParentObject().export(),
      stream: false,
      mode: "auto",
      strict: true,
    };
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (projectId) {
      headers["x-bt-project-id"] = projectId;
    }
    const result = await state.proxyConn().post(`function/invoke`, request, {
      headers,
    });
    const data = await result.json();
    // NOTE: Ideally we can parse this value with a zod schema.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return data as OneOrMoreScores;
  };

  Object.defineProperties(ret, {
    name: { value: `Remote eval scorer (${name})` },
  });

  return ret;
}

// Infer a JSON schema from a raw value
function inferJsonSchemaFromValue(value: unknown): Record<string, unknown> {
  if (value === null) {
    return { type: "null" };
  }
  if (typeof value === "string") {
    return { type: "string", default: value };
  }
  if (typeof value === "number") {
    return { type: "number", default: value };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", default: value };
  }
  if (Array.isArray(value)) {
    return { type: "array", default: value };
  }
  if (typeof value === "object") {
    return { type: "object", default: value };
  }
  return {};
}

export function makeEvalParametersSchema(
  parameters: EvalParameters | Record<string, unknown> | Config<Record<string, unknown>>,
): z.infer<typeof evalParametersSerializedSchema> {
  // Check if this is a Config instance (from loadConfig)
  // If so, use its schema and data directly
  if (Config.isConfig(parameters)) {
    const explicitSchema = parameters.schema;
    const configData = parameters.data;

    // If the config has an explicit schema, use it
    if (explicitSchema) {
      return Object.fromEntries(
        Object.entries(configData).map(([name, value]) => {
          // Extract per-property schema from the explicit schema
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const propSchema = (explicitSchema as any)?.properties?.[name] ?? {};
          return [
            name,
            {
              type: "data",
              schema: { ...propSchema, default: value },
              default: value,
              description: propSchema.description,
            },
          ];
        }),
      );
    }

    // Fall back to inferring schema from data
    return Object.fromEntries(
      Object.entries(configData).map(([name, value]) => {
        const inferredSchema = inferJsonSchemaFromValue(value);
        return [
          name,
          {
            type: "data",
            schema: inferredSchema,
            default: inferredSchema.default,
            description: undefined,
          },
        ];
      }),
    );
  }

  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => {
      // Check if this is a prompt parameter definition
      if (
        value !== null &&
        typeof value === "object" &&
        "type" in value &&
        value.type === "prompt"
      ) {
        return [
          name,
          {
            type: "prompt",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            default: (value as any).default
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                promptDefinitionToPromptData((value as any).default)
              : undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            description: (value as any).description,
          },
        ];
      }

      // Check if this is a Zod schema
      if (isZodSchema(value)) {
        // Since this schema is bundled, it won't pass an instanceof check. For
        // some reason, aliasing it to `z.ZodSchema` leads to `error TS2589:
        // Type instantiation is excessively deep and possibly infinite.` So
        // just using `any` to turn off the typesystem.
        //
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const schemaObj = zodToJsonSchema(value as any);
        return [
          name,
          {
            type: "data",
            schema: schemaObj,
            default: schemaObj.default,
            description: schemaObj.description,
          },
        ];
      }

      // Raw value (e.g. from loadConfig) - infer schema from the value
      const inferredSchema = inferJsonSchemaFromValue(value);
      return [
        name,
        {
          type: "data",
          schema: inferredSchema,
          default: inferredSchema.default,
          description: undefined,
        },
      ];
    }),
  );
}
