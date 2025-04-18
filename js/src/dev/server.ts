import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { callEvaluatorData, Eval, EvalHooks, EvaluatorDef } from "../framework";
import { errorHandler } from "./errorHandler";
import {
  authorizeRequest,
  baseAllowedHeaders,
  checkAuthorized,
  checkOrigin,
} from "./authorize";
import {
  promptDataSchema,
  SSEProgressEventData,
} from "@braintrust/core/typespecs";
import {
  BaseMetadata,
  BraintrustState,
  LoginOptions,
  loginToState,
  Prompt,
} from "../logger";
import { LRUCache } from "../prompt-cache/lru-cache";
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
  makeEvalParametersSchema,
} from "./types";
import { EvalParameters, InferParameters } from "../eval-parameters";
import { z } from "zod";
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

  // TODO:
  // - Apply appropriate request body size, response body size, and CORS headers
  // - Auth, can use the token from the incoming request (if specified) to override
  //   whatever is in the environment.
  //    - Maybe allow the user to explicitly opt into authenticating via local credentials.
  // - Allow the task function to return a BraintrustStream, and therefore stream its results
  //   to the client instead. If we do this, maybe we can simplify/remove the progress stuff
  //   from the task function.
  app.use(express.json({ limit: "1gb" }));

  console.log("Starting server");
  app.use(
    // These should match the settings in api/app.py.
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
        },
      ]),
    );
    res.json(evalDefs);
  });

  app.post(
    "/eval",
    checkAuthorized,
    asyncHandler(async (req, res) => {
      const { name, parameters, parent } = evalBodySchema.parse(req.body);

      // First, log in
      const state = await cachedLogin({ apiKey: req.ctx?.token });

      const evaluator = allEvaluators[name];

      if (!evaluator) {
        res.status(404).json({ error: `Evaluator '${name}' not found` });
        return;
      }

      let parsedParameters: Record<string, unknown> = {};
      if (parameters && Object.keys(parameters).length > 0) {
        try {
          if (!evaluator.parameters) {
            res.status(400).json({
              error: `Evaluator '${name}' does not accept parameters`,
            });
            return;
          }

          parsedParameters = validateParameters(
            parameters,
            evaluator.parameters,
          );
        } catch (e) {
          if (e instanceof z.ZodError) {
            res.status(400).json({ error: e.message });
            return;
          }
          throw e;
        }
      }

      const evalData = callEvaluatorData(evaluator.data);
      console.log("Starting eval", evaluator.evalName);

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

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
              res.write(
                serializeSSEEvent({
                  event: "progress",
                  data: JSON.stringify(data),
                }),
              );
            },
            onStart: (metadata) => {
              res.write(
                serializeSSEEvent({
                  event: "start",
                  data: JSON.stringify(metadata),
                }),
              );
            },
            parent: parseParent(parent),
            parameters: parsedParameters,
          },
        );

        res.write(
          serializeSSEEvent({
            event: "summary",
            data: JSON.stringify(summary),
          }),
        );
        res.write(
          serializeSSEEvent({
            event: "done",
            data: "",
          }),
        );
      } catch (e) {
        console.error("Error running eval", e);
        res.write(
          serializeSSEEvent({
            event: "error",
            data: JSON.stringify(e),
          }),
        );
      }
      res.end();
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

function validateParameters<Parameters extends EvalParameters = EvalParameters>(
  parameters: Record<string, unknown>,
  parameterSchema: Parameters,
): InferParameters<Parameters> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return Object.fromEntries(
    Object.entries(parameterSchema).map(([name, schema]) => {
      const value = parameters[name];
      if (schema === "prompt") {
        const promptData = promptDataSchema.parse(value);
        console.log(JSON.stringify(promptData, null, 2));
        return [name, Prompt.fromPromptData(name, promptData)];
      } else {
        return [name, schema.parse(value)];
      }
    }),
  ) as InferParameters<Parameters>;
}

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
