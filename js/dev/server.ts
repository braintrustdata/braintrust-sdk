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
  checkAuthorized,
  checkOrigin,
} from "./authorize";
import {
  FunctionId,
  InvokeFunctionRequest,
  RunEvalRequest,
  SSEProgressEventData,
} from "@braintrust/core/typespecs";
import {
  BaseMetadata,
  BraintrustState,
  EvalCase,
  getSpanParentObject,
  initDataset,
  LoginOptions,
  loginToState,
} from "../src/logger";
import { LRUCache } from "../src/prompt-cache/lru-cache";
import {
  BT_CURSOR_HEADER,
  BT_FOUND_EXISTING_HEADER,
  parseParent,
} from "@braintrust/core";
import { serializeSSEEvent } from "./stream";
import {
  evalBodySchema,
  EvaluatorDefinitions,
  EvaluatorManifest,
  evalParametersSerializedSchema,
} from "./types";
import { EvalParameters, validateParameters } from "../src/eval-parameters";
import { z } from "zod";
import { promptDefinitionToPromptData } from "../src/framework2";
import zodToJsonSchema from "zod-to-json-schema";
export interface DevServerOpts {
  host: string;
  port: number;
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
  app.get("/list", (req, res) => {
    const evalDefs: EvaluatorDefinitions = Object.fromEntries(
      Object.entries(allEvaluators).map(([name, evaluator]) => [
        name,
        {
          parameters: evaluator.parameters
            ? makeEvalParametersSchema(evaluator.parameters)
            : undefined,
          scores: evaluator.scores.map((score, idx) => ({
            name: scorerName(score, idx),
          })),
        },
      ]),
    );
    res.json(evalDefs);
  });

  app.post(
    "/eval",
    checkAuthorized,
    asyncHandler(async (req, res) => {
      const { name, parameters, parent, data, scores, stream } =
        evalBodySchema.parse(req.body);

      const state = await cachedLogin({ apiKey: req.ctx?.token });

      const evaluator = allEvaluators[name];
      if (!evaluator) {
        res.status(404).json({ error: `Evaluator '${name}' not found` });
        return;
      }

      if (
        evaluator.parameters &&
        Object.keys(evaluator.parameters).length > 0
      ) {
        try {
          if (!evaluator.parameters) {
            res.status(400).json({
              error: `Evaluator '${name}' does not accept parameters`,
            });
            return;
          }

          // This gets done again in the framework, but we do it here too to give a
          // better error message.
          validateParameters(parameters ?? {}, evaluator.parameters);
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
        hooks: EvalHooks<unknown, BaseMetadata, EvalParameters>,
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
                makeScorer(state, score.name, score.function_id),
              ) ?? [],
            ),
            task,
            state,
          },
          {
            // Avoid printing the bar to the console.
            progress: {
              start: (name, total) => {},
              stop: () => {
                console.log("Finished running experiment");
              },
              increment: (name) => {},
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

const loginCache = new LRUCache<string, BraintrustState>({
  max: 32, // TODO: Make this configurable
});

async function cachedLogin(options: LoginOptions): Promise<BraintrustState> {
  const key = JSON.stringify(options);
  const cached = loginCache.get(key);
  if (cached) {
    return cached;
  }

  const state = await loginToState(options);
  loginCache.set(key, state);
  return state;
}

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
    const result = await state.proxyConn().post(`function/invoke`, request, {
      headers: {
        Accept: "application/json",
      },
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

function makeEvalParametersSchema(
  parameters: EvalParameters,
): z.infer<typeof evalParametersSerializedSchema> {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => {
      if ("type" in value && value.type === "prompt") {
        return [
          name,
          {
            type: "prompt",
            default: value.default
              ? promptDefinitionToPromptData(value.default)
              : undefined,
            description: value.description,
          },
        ];
      } else {
        return [
          name,
          {
            type: "data",
            // Since this schema is bundled, it won't pass an instanceof check.
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            schema: zodToJsonSchema(value as z.ZodSchema),
            default: value.default,
            description: value.description,
          },
        ];
      }
    }),
  );
}
