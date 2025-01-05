import { EvaluatorState } from "../cli";
import express, { NextFunction, Request, Response } from "express";
import { EvaluatorDef, getSingleValueParameters } from "../framework";
import { z } from "zod";
import { errorHandler } from "./errorHandler";
import { authorizeRequest, checkAuthorized } from "./authorize";
import { invokeParent } from "@braintrust/core/typespecs";
import {
  BaseMetadata,
  BraintrustState,
  LoginOptions,
  loginToState,
} from "../logger";
import { LRUCache } from "../prompt-cache/lru-cache";

export interface DevServerOpts {
  host: string;
  port: number;
}

export function runDevServer(evaluators: EvaluatorState, opts: DevServerOpts) {
  const allEvaluators: EvaluatorManifest = Object.fromEntries(
    Object.values(evaluators.evaluators).map((evaluator) => [
      evaluator.evaluator.evalName,
      {
        parameters: Object.fromEntries(
          Object.entries(
            getSingleValueParameters(evaluator.evaluator.parameters ?? {})[0],
          ).map(([name, value]) => [name, deriveParameterType(value)]),
        ),
        evaluator: evaluator.evaluator,
      },
    ]),
  );

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
  app.use(authorizeRequest);

  app.get("/", (req, res) => {
    res.send("Hello, world!");
  });

  // List endpoint - returns all available evaluators and their metadata
  app.get("/list", (req, res) => {
    const evaluatorSpec = Object.fromEntries(
      Object.entries(allEvaluators).map(([name, evaluator]) => [
        name,
        {
          parameters: evaluator.parameters,
        },
      ]),
    );
    res.json(evaluatorSpec);
  });

  // Eval endpoint - runs an evaluator and streams the results
  app.post(
    "/eval",
    checkAuthorized,
    asyncHandler(async (req, res) => {
      const { name, parameters, parent } = evalBodySchema.parse(req.body);

      // First, log in
      const state = await cachedLogin({ apiKey: req.ctx?.token });

      const handle = allEvaluators[name];

      if (!handle) {
        res.status(404).json({ error: `Evaluator '${name}' not found` });
        return;
      }

      // try {
      //   const stream = await handle.evaluate(parameters, parent);
      //   const response = new StreamingTextResponse(stream);

      //   // Forward the streaming response
      //   response.body?.pipeTo(
      //     new WritableStream({
      //       write(chunk) {
      //         res.write(chunk);
      //       },
      //       close() {
      //         res.end();
      //       },
      //     }),
      //   );
      // } catch (error) {
      //   res.status(500).json({ error: String(error) });
      // }

      res.json({ name, parameters, parent });
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

const evalBodySchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  parent: invokeParent.optional(),
});

type EvaluatorManifest = Record<string, EvaluatorSpec>;

interface EvaluatorSpec {
  parameters: Record<string, ParameterType>;
  evaluator: EvaluatorDef<unknown, unknown, unknown, BaseMetadata>;
}

const _parameterTypeSchema = z.union([
  z.literal("string"),
  z.literal("number"),
  z.literal("boolean"),
  z.literal("prompt"),
  z.literal("unknown"),
]);
export type ParameterType = z.infer<typeof _parameterTypeSchema>;

function deriveParameterType(value: unknown): ParameterType {
  if (typeof value === "string") {
    return "string";
  } else if (typeof value === "number") {
    return "number";
  } else if (typeof value === "boolean") {
    return "boolean";
  }
  // TODO: Prompt type
  return "unknown";
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