import { EvaluatorState } from "./cli";
import express from "express";
import { getSingleValueParameters } from "./framework";
import { z } from "zod";

export interface DevServerOpts {
  host: string;
  port: number;
}

export function runDevServer(evaluators: EvaluatorState, opts: DevServerOpts) {
  const app = express();

  // TODO:
  // - Apply appropriate request body size, response body size, and CORS headers
  // - Auth, can use the token from the incoming request (if specified) to override
  //   whatever is in the environment.
  //    - Maybe allow the user to explicitly opt into authenticating via local credentials.
  // - Allow the task function to return a BraintrustStream, and therefore stream its results
  //   to the client instead. If we do this, maybe we can simplify/remove the progress stuff
  //   from the task function.
  app.use(express.json());

  app.get("/", (req, res) => {
    res.send("Hello, world!");
  });

  // List endpoint - returns all available evaluators and their metadata
  app.get("/list", (req, res) => {
    const evaluatorInfo = Object.values(evaluators.evaluators).map(
      (evaluator) => ({
        name: evaluator.evaluator.evalName,
        parameters: Object.entries(
          getSingleValueParameters(evaluator.evaluator.parameters ?? {})[0],
        ).map(([name, value]) => ({ name, type: deriveParameterType(value) })),
      }),
    );
    res.json(evaluatorInfo);
  });

  // Eval endpoint - runs an evaluator and streams the results
  /*
  app.post("/eval", async (req, res) => {
    const { name, parameters, parent } = req.body;
    const handle = handles[name];

    if (!handle) {
      return res.status(404).json({ error: `Evaluator '${name}' not found` });
    }

    try {
      const stream = await handle.evaluate(parameters, parent);
      const response = new StreamingTextResponse(stream);

      // Forward the streaming response
      response.body?.pipeTo(
        new WritableStream({
          write(chunk) {
            res.write(chunk);
          },
          close() {
            res.end();
          },
        }),
      );
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
  */

  // Start the server
  app.listen(opts.port, opts.host, () => {
    console.log(`Dev server running at http://${opts.host}:${opts.port}`);
  });
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
