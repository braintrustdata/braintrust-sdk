import { z } from "zod";
import { promptDataSchema } from "./prompt";

export const validRuntimesEnum = z.enum(["node", "python"]);
export type Runtime = z.infer<typeof validRuntimesEnum>;

export const runtimeContextSchema = z.object({
  runtime: validRuntimesEnum,
  version: z.string(),
});
export type RuntimeContext = z.infer<typeof runtimeContextSchema>;

export const functionIdSchema = z
  .union([
    z
      .object({
        function_id: z.string().describe("The ID of the function"),
        version: z.string().optional().describe("The version of the function"),
      })
      .describe("Function id"),
    z
      .object({
        project_name: z
          .string()
          .describe("The name of the project containing the function"),
        slug: z.string().describe("The slug of the function"),
        version: z.string().optional().describe("The version of the function"),
      })
      .describe("Project name and slug"),
    z
      .object({
        global_function: z
          .string()
          .describe(
            "The name of the global function. Currently, the global namespace includes the functions in autoevals",
          ),
      })
      .describe("Global function name"),
    z
      .object({
        prompt_session_id: z.string().describe("The ID of the prompt session"),
        prompt_session_function_id: z
          .string()
          .describe("The ID of the function in the prompt session"),
        version: z.string().optional().describe("The version of the function"),
      })
      .describe("Prompt session id"),
    z
      .object({
        inline_context: runtimeContextSchema,
        code: z.string().describe("The inline code to execute"),
      })
      .describe("Inline code function"),
    z
      .object({
        inline_prompt: promptDataSchema,
      })
      .describe("Inline prompt definition"),
  ])
  .describe("Options for identifying a function");

export type FunctionId = z.infer<typeof functionIdSchema>;

export const useFunctionSchema = functionIdSchema;

export const streamingModeEnum = z.enum(["auto", "parallel"]);
export type StreamingMode = z.infer<typeof streamingModeEnum>;

export const invokeFunctionNonIdArgsSchema = z.object({
  input: z
    .any()
    .optional()
    .describe(
      "Argument to the function, which can be any JSON serializable value",
    ),
  parent: z
    .union([
      z
        .object({
          object_type: z.enum(["project_logs", "experiment"]),
          object_id: z
            .string()
            .describe("The id of the container object you are logging to"),
          row_ids: z
            .object({
              id: z.string().describe("The id of the row"),
              span_id: z.string().describe("The span_id of the row"),
              root_span_id: z.string().describe("The root_span_id of the row"),
            })
            .nullish()
            .describe("Identifiers for the row to to log a subspan under"),
        })
        .describe("Object type, object id, and optional row IDs"),
      z
        .string()
        .optional()
        .describe(
          "The parent's span identifier, created by calling `.export()` on a span",
        ),
    ])
    .describe("Options for tracing the function call"),
  stream: z
    .boolean()
    .optional()
    .describe(
      "Whether to stream the response. If true, results will be returned in the Braintrust SSE format.",
    ),
  mode: streamingModeEnum
    .optional()
    .describe("The mode format of the returned value (defaults to 'auto')"),
});

export const invokeFunctionSchema = functionIdSchema.and(
  invokeFunctionNonIdArgsSchema,
);
export type InvokeFunctionRequest = z.infer<typeof invokeFunctionSchema>;

export const invokeApiSchema = invokeFunctionNonIdArgsSchema
  .merge(
    z.object({
      version: z.string().optional().describe("The version of the function"),
    }),
  )
  .describe("The request to invoke a function");

export const runEvalSchema = z.object({
  project_id: z
    .string()
    .describe("Unique identifier for the project to run the eval in"),
  data: z
    .union([
      z
        .object({
          dataset_id: z.string(),
        })
        .describe("Dataset id"),
      z
        .object({
          project_name: z.string(),
          dataset_name: z.string(),
        })
        .describe("Project and dataset name"),
    ])
    .describe("The dataset to use"),
  task: functionIdSchema.describe("The function to evaluate"),
  scores: z
    .array(functionIdSchema)
    .describe("The functions to score the eval on"),
  experiment_name: z
    .string()
    .optional()
    .describe(
      "An optional name for the experiment created by this eval. If it conflicts with an existing experiment, it will be suffixed with a unique identifier.",
    ),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe(
      "Optional experiment-level metadata to store about the evaluation. You can later use this to slice & dice across experiments.",
    ),
  stream: z
    .boolean()
    .optional()
    .describe(
      "Whether to stream the results of the eval. If true, the request will return two events: one to indicate the experiment has started, and another upon completion. If false, the request will return the evaluation's summary upon completion.",
    ),
});

export type RunEvalRequest = z.infer<typeof runEvalSchema>;

export const baseSSEEventSchema = z.object({
  id: z.string().optional(),
  data: z.string(),
});

// This should eventually move into the typespecs in @braintrust/core
//
export const sseTextEventSchema = baseSSEEventSchema.merge(
  z.object({
    event: z.literal("text_delta"),
  }),
);

export const sseDataEventSchema = baseSSEEventSchema.merge(
  z.object({
    event: z.literal("json_delta"),
  }),
);

export const sseDoneEventSchema = baseSSEEventSchema.omit({ data: true }).merge(
  z.object({
    event: z.literal("done"),
    data: z.literal(""),
  }),
);

export const callEventSchema = z.union([
  sseTextEventSchema.openapi({ title: "text_delta" }),
  sseDataEventSchema.openapi({ title: "json_delta" }),
  sseDoneEventSchema.openapi({ title: "done" }),
]);

export type CallEventSchema = z.infer<typeof callEventSchema>;

export const scoreSchema = z.union([
  z.object({
    name: z.string(),
    score: z.number().min(0).max(1).nullable().default(null), // Sometimes we get an empty value over the wire
    metadata: z
      .record(z.unknown())
      .optional()
      .transform((data) => data ?? undefined),
  }),
  z.number().min(0).max(1),
  z.boolean().transform((b) => (b ? 1 : 0)),
  z.null(),
]);
