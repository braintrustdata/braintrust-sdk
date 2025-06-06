import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
extendZodWithOpenApi(z);
import { promptDataSchema } from "./prompt";
import { chatCompletionMessageParamSchema } from "./openai/messages";
import { customTypes } from "./custom_types";
import { gitMetadataSettingsSchema, repoInfoSchema } from "./git_types";
import { objectReferenceSchema } from "./common_types";
import { graphDataSchema } from "./graph";

export const validRuntimesEnum = z.enum(["node", "python"]);
export type Runtime = z.infer<typeof validRuntimesEnum>;

export const functionTypeEnum = z.enum(["llm", "scorer", "task", "tool"]);
export type FunctionType = z.infer<typeof functionTypeEnum>;

export const runtimeContextSchema = z.object({
  runtime: validRuntimesEnum,
  version: z.string(),
});
export type RuntimeContext = z.infer<typeof runtimeContextSchema>;

const strictParam = z
  .boolean()
  .nullish()
  .describe(
    "If true, throw an error if one of the variables in the prompt is not present in the input",
  );
export const codeBundleSchema = z
  .object({
    runtime_context: runtimeContextSchema,
    location: z.union([
      z
        .object({
          type: z.literal("experiment"),
          eval_name: z.string(),
          position: z.union([
            z.object({ type: z.literal("task") }),
            z
              .object({
                type: z.literal("scorer"),
                index: z.number().int().nonnegative(),
              })
              .openapi({ title: "scorer" }),
          ]),
        })
        .openapi({ title: "experiment" }),
      z
        .object({
          type: z.literal("function"),
          index: z.number().int().nonnegative(),
        })
        .openapi({ title: "function" }),
    ]),
    bundle_id: z.string(),
    preview: z.string().nullish().describe("A preview of the code"),
  })
  .openapi("CodeBundle");
export type CodeBundle = z.infer<typeof codeBundleSchema>;

export const remoteEvalDataSchema = z.object({
  type: z.literal("remote_eval"),
  endpoint: z.string(),
  eval_name: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});
export type RemoteEvalData = z.infer<typeof remoteEvalDataSchema>;

export const functionDataSchema = z
  .union([
    z
      .object({
        type: z.literal("prompt"),
        // For backwards compatibility reasons, the prompt definition is hoisted out and stored
        // in the outer object
      })
      .openapi({ title: "prompt" }),
    z
      .object({
        type: z.literal("code"),
        data: z.union([
          z
            .object({
              type: z.literal("bundle"),
            })
            .and(codeBundleSchema)
            .openapi({ title: "bundle" }),
          z
            .object({
              type: z.literal("inline"),
              runtime_context: runtimeContextSchema,
              code: z.string(),
            })
            .openapi({ title: "inline" }),
        ]),
      })
      .openapi({ title: "code" }),
    graphDataSchema.openapi({
      title: "graph",
      description: "This feature is preliminary and unsupported.",
    }),
    remoteEvalDataSchema.openapi({
      title: "remote_eval",
      description: "A remote eval to run",
    }),
    z
      .object({
        type: z.literal("global"),
        name: z.string(),
      })
      .openapi({ title: "global" }),
  ])
  .openapi("FunctionData");

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
        inline_prompt: promptDataSchema.optional(),
        inline_function: z.record(z.unknown()), // This creates a circular dependency
        name: z.string().nullish().describe("The name of the inline function"),
      })
      .describe("Inline function definition")
      .openapi({ title: "inline_function" }),
    z
      .object({
        inline_prompt: promptDataSchema,
        name: z.string().nullish().describe("The name of the inline prompt"),
      })
      .describe("Inline prompt definition")
      .openapi({ title: "inline_prompt" }),
  ])
  .describe("Options for identifying a function")
  .openapi({
    title: "FunctionId",
    description: "Options for identifying a function",
  });

export type FunctionId = z.infer<typeof functionIdSchema>;

export const useFunctionSchema = functionIdSchema;

export const streamingModeEnum = z.enum(["auto", "parallel"]);
export type StreamingMode = z.infer<typeof streamingModeEnum>;

const spanParentObjectTypeSchema = z.enum([
  "project_logs",
  "experiment",
  "playground_logs",
]);
export const invokeParent = z.union([
  z
    .object({
      object_type: spanParentObjectTypeSchema,
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
]);

const fetchRowFieldsSchema = z.object({
  object_type: spanParentObjectTypeSchema.describe(
    "The type of the object you are logging to",
  ),
  object_id: z.string().describe("The id of the object you are logging to"),
  row_id: z.string().describe("The row id to fetch"),
  fields: z.array(z.string()).describe("The fields to fetch"),
});

export const invokeFunctionNonIdArgsSchema = z.object({
  input: customTypes.unknown
    .optional()
    .describe(
      "Argument to the function, which can be any JSON serializable value",
    ),
  fetch_row_fields: fetchRowFieldsSchema
    .nullish()
    .describe("If provided, the row id and fields to fetch before invoke"),
  expected: customTypes.unknown
    .optional()
    .describe("The expected output of the function"),
  metadata: z
    .record(z.string(), z.unknown())
    .nullish()
    .describe(
      "Any relevant metadata. This will be logged and available as the `metadata` argument.",
    ),
  tags: z
    .array(z.string())
    .nullish()
    .describe("Any relevant tags to log on the span."),
  messages: z
    .array(chatCompletionMessageParamSchema)
    .optional()
    .describe(
      "If the function is an LLM, additional messages to pass along to it",
    ),
  parent: invokeParent.describe("Options for tracing the function call"),
  stream: z
    .boolean()
    .nullish()
    .describe(
      "Whether to stream the response. If true, results will be returned in the Braintrust SSE format.",
    ),
  mode: streamingModeEnum
    .nullish()
    .describe("The mode format of the returned value (defaults to 'auto')"),
  strict: strictParam,
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

const stopToken = z.string().nullish().describe("The token to stop the run");

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
            _internal_btql: z.record(z.string(), z.unknown()).nullish(),
          })
          .describe("Dataset id")
          .openapi({ title: "dataset_id" }),
        z
          .object({
            project_name: z.string(),
            dataset_name: z.string(),
            _internal_btql: z.record(z.string(), z.unknown()).nullish(),
          })
          .describe("Project and dataset name")
          .openapi({ title: "project_dataset_name" }),
        z
          .object({
            data: z.array(z.unknown()), // TODO: More specific schema for these?
          })
          .describe("Dataset rows")
          .openapi({ title: "dataset_rows" }),
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
    parent: invokeParent.describe("Options for tracing the evaluation"),
    stream: z
      .boolean()
      .optional()
      .describe(
        "Whether to stream the results of the eval. If true, the request will return two events: one to indicate the experiment has started, and another upon completion. If false, the request will return the evaluation's summary upon completion.",
      ),
    trial_count: z
      .number()
      .nullish()
      .describe(
        "The number of times to run the evaluator per input. This is useful for evaluating applications that have non-deterministic behavior and gives you both a stronger aggregate measure and a sense of the variance in the results.",
      ),
    is_public: z
      .boolean()
      .nullish()
      .describe("Whether the experiment should be public. Defaults to false."),
    timeout: z
      .number()
      .nullish()
      .describe(
        "The maximum duration, in milliseconds, to run the evaluation. Defaults to undefined, in which case there is no timeout.",
      ),
    max_concurrency: z
      .number()
      .nullish()
      .transform((val) => (val === undefined ? 10 : val))
      .describe(
        "The maximum number of tasks/scorers that will be run concurrently. Defaults to 10. If null is provided, no max concurrency will be used.",
      ),
    base_experiment_name: z
      .string()
      .nullish()
      .describe(
        "An optional experiment name to use as a base. If specified, the new experiment will be summarized and compared to this experiment.",
      ),
    base_experiment_id: z
      .string()
      .nullish()
      .describe(
        "An optional experiment id to use as a base. If specified, the new experiment will be summarized and compared to this experiment.",
      ),
    git_metadata_settings: gitMetadataSettingsSchema
      .nullish()
      .describe(
        "Optional settings for collecting git metadata. By default, will collect all git metadata fields allowed in org-level settings.",
      ),
    repo_info: repoInfoSchema
      .nullish()
      .describe(
        "Optionally explicitly specify the git metadata for this experiment. This takes precedence over `gitMetadataSettings` if specified.",
      ),
    strict: strictParam,
    stop_token: stopToken,
    extra_messages: z
      .string()
      .optional()
      .describe(
        "A template path of extra messages to append to the conversion. These messages will be appended to the end of the conversation, after the last message.",
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

export const sseReasoningEventSchema = baseSSEEventSchema.merge(
  z.object({
    event: z.literal("reasoning_delta"),
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

export const sseConsoleEventSchema = baseSSEEventSchema.merge(
  z.object({
    event: z.literal("console"),
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
  .enum(["prompt", "tool", "scorer", "task", "agent"])
  .openapi("FunctionObjectType");
export type FunctionObjectType = z.infer<typeof functionObjectTypeEnum>;
export const functionFormatEnum = z
  .enum(["llm", "code", "global", "graph"])
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
    origin: objectReferenceSchema.nullish().describe("The origin of the event"),
    format: functionFormatEnum,
    output_type: functionOutputTypeEnum,
    name: z.string(),
    event: z.enum([
      "reasoning_delta",
      "text_delta",
      "json_delta",
      "error",
      "console",
      "start",
      "done",
      "progress",
    ]),
    data: z.string(), // This is the text_delta or json_delta
  })
  .openapi("SSEProgressEventData");
export type SSEProgressEventData = z.infer<typeof sseProgressEventDataSchema>;

export const sseConsoleEventDataSchema = z.object({
  stream: z.enum(["stderr", "stdout"]),
  message: z.string(),
});
export type SSEConsoleEventData = z.infer<typeof sseConsoleEventDataSchema>;

export const callEventSchema = z
  .union([
    sseTextEventSchema.openapi({ title: "text_delta" }),
    sseReasoningEventSchema.openapi({ title: "reasoning_delta" }),
    sseDataEventSchema.openapi({ title: "json_delta" }),
    sseProgressEventSchema.openapi({ title: "progress" }),
    sseErrorEventSchema.openapi({ title: "error" }),
    sseConsoleEventSchema.openapi({ title: "console" }),
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

export const toolFunctionDefinitionSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
    strict: z.boolean().nullish(),
  }),
});
export type ToolFunctionDefinition = z.infer<
  typeof toolFunctionDefinitionSchema
>;

export const stopFunctionSchema = z
  .object({
    stop_token: z.string().describe("The token to stop the run"),
  })
  .openapi("StopFunction");
export type StopFunction = z.infer<typeof stopFunctionSchema>;
