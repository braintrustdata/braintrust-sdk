import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
extendZodWithOpenApi(z);
import { promptDataSchema } from "./prompt";
import { chatCompletionMessageParamSchema } from "./openai/messages";
import { customTypes } from "./custom_types";

export const validRuntimesEnum = z.enum(["node", "python"]);
export type Runtime = z.infer<typeof validRuntimesEnum>;

export const functionTypeEnum = z.enum(["llm", "scorer", "task", "tool"]);
export type FunctionType = z.infer<typeof functionTypeEnum>;

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
      .describe("Function id")
      .openapi({ title: "function_id" }),
    z
      .object({
        project_name: z
          .string()
          .describe("The name of the project containing the function"),
        slug: z.string().describe("The slug of the function"),
        version: z.string().optional().describe("The version of the function"),
      })
      .describe("Project name and slug")
      .openapi({ title: "project_slug" }),
    z
      .object({
        global_function: z
          .string()
          .describe(
            "The name of the global function. Currently, the global namespace includes the functions in autoevals",
          ),
      })
      .describe("Global function name")
      .openapi({ title: "global_function" }),
    z
      .object({
        prompt_session_id: z.string().describe("The ID of the prompt session"),
        prompt_session_function_id: z
          .string()
          .describe("The ID of the function in the prompt session"),
        version: z.string().optional().describe("The version of the function"),
      })
      .describe("Prompt session id")
      .openapi({ title: "prompt_session_id" }),
    z
      .object({
        inline_context: runtimeContextSchema,
        code: z.string().describe("The inline code to execute"),
        name: z
          .string()
          .nullish()
          .describe("The name of the inline code function"),
      })
      .describe("Inline code function")
      .openapi({ title: "inline_code" }),
    z
      .object({
        inline_prompt: promptDataSchema,
        name: z.string().nullish().describe("The name of the inline prompt"),
      })
      .describe("Inline prompt definition")
      .openapi({ title: "inline_prompt" }),
  ])
  .describe("Options for identifying a function")
  .openapi("FunctionId");

export type FunctionId = z.infer<typeof functionIdSchema>;

export const useFunctionSchema = functionIdSchema;

export const streamingModeEnum = z.enum(["auto", "parallel"]);
export type StreamingMode = z.infer<typeof streamingModeEnum>;

export const invokeFunctionNonIdArgsSchema = z.object({
  input: customTypes.unknown
    .optional()
    .describe(
      "Argument to the function, which can be any JSON serializable value",
    ),
  messages: z
    .array(chatCompletionMessageParamSchema)
    .optional()
    .describe(
      "If the function is an LLM, additional messages to pass along to it",
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
          propagated_event: z
            .record(customTypes.unknown)
            .nullish()
            .describe(
              "Include these properties in every span created under this parent",
            ),
        })
        .describe("Span parent properties")
        .openapi({ title: "span_parent_struct" }),
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
    .nullish()
    .describe(
      "Whether to stream the response. If true, results will be returned in the Braintrust SSE format.",
    ),
  mode: streamingModeEnum
    .nullish()
    .describe("The mode format of the returned value (defaults to 'auto')"),
});

export const invokeFunctionSchema = functionIdSchema
  .and(invokeFunctionNonIdArgsSchema)
  .openapi("InvokeFunction");
export type InvokeFunctionRequest = z.infer<typeof invokeFunctionSchema>;

export const invokeApiSchema = invokeFunctionNonIdArgsSchema
  .merge(
    z.object({
      version: z.string().optional().describe("The version of the function"),
    }),
  )
  .describe("The request to invoke a function")
  .openapi("InvokeApi");

export const runEvalSchema = z
  .object({
    project_id: z
      .string()
      .describe("Unique identifier for the project to run the eval in"),
    data: z
      .union([
        z
          .object({
            dataset_id: z.string(),
          })
          .describe("Dataset id")
          .openapi({ title: "dataset_id" }),
        z
          .object({
            project_name: z.string(),
            dataset_name: z.string(),
          })
          .describe("Project and dataset name")
          .openapi({ title: "project_dataset_name" }),
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
      .record(customTypes.unknown)
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
  })
  .openapi("RunEval");

export type RunEvalRequest = z.infer<typeof runEvalSchema>;

export const baseSSEEventSchema = z.object({
  id: z.string().optional(),
  data: z.string(),
});

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

export const sseErrorEventSchema = baseSSEEventSchema.merge(
  z.object({
    event: z.literal("error"),
  }),
);

export const sseProgressEventSchema = baseSSEEventSchema.merge(
  z.object({
    event: z.literal("progress"),
  }),
);

// Both start and end are no-op events that just help display progress
export const sseStartEventSchema = baseSSEEventSchema
  .omit({ data: true })
  .merge(
    z.object({
      event: z.literal("start"),
      data: z.literal(""),
    }),
  );

export const sseDoneEventSchema = baseSSEEventSchema.omit({ data: true }).merge(
  z.object({
    event: z.literal("done"),
    data: z.literal(""),
  }),
);

export const functionObjectTypeEnum = z
  .enum(["prompt", "tool", "scorer", "task"])
  .openapi("FunctionObjectType");
export type FunctionObjectType = z.infer<typeof functionObjectTypeEnum>;
export const functionFormatEnum = z
  .enum(["llm", "code", "global"])
  .openapi("FunctionFormat");
export type FunctionFormat = z.infer<typeof functionFormatEnum>;
export const functionOutputTypeEnum = z
  .enum(["completion", "score", "any"])
  .openapi("FunctionOutputType");
export type FunctionOutputType = z.infer<typeof functionOutputTypeEnum>;

export const sseProgressEventDataSchema = z
  .object({
    id: z.string().describe("The id of the span this event is for"),
    object_type: functionObjectTypeEnum,
    format: functionFormatEnum,
    output_type: functionOutputTypeEnum,
    name: z.string(),
    event: z.enum(["text_delta", "json_delta", "error", "start", "done"]),
    data: z.string(), // This is the text_delta or json_delta
  })
  .openapi("SSEProgressEventData");
export type SSEProgressEventData = z.infer<typeof sseProgressEventDataSchema>;

export const callEventSchema = z
  .union([
    sseTextEventSchema.openapi({ title: "text_delta" }),
    sseDataEventSchema.openapi({ title: "json_delta" }),
    sseProgressEventSchema.openapi({ title: "progress" }),
    sseErrorEventSchema.openapi({ title: "error" }),
    sseStartEventSchema.openapi({ title: "start" }),
    sseDoneEventSchema.openapi({ title: "done" }),
  ])
  .openapi("CallEvent");

export type CallEventSchema = z.infer<typeof callEventSchema>;

export const scoreSchema = z
  .union([
    z.object({
      name: z.string(),
      score: z.number().min(0).max(1).nullable().default(null), // Sometimes we get an empty value over the wire
      metadata: z
        .record(customTypes.unknown)
        .optional()
        .transform((data) => data ?? undefined),
    }),
    z.number().min(0).max(1),
    z.boolean().transform((b) => (b ? 1 : 0)),
    z.null(),
  ])
  .openapi("ScorerScore");

export const ifExistsEnum = z.enum(["error", "ignore", "replace"]);
export type IfExists = z.infer<typeof ifExistsEnum>;
export const DEFAULT_IF_EXISTS: IfExists = "error";
