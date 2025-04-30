import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
extendZodWithOpenApi(z);
import {
  chatCompletionContentPartSchema,
  chatCompletionContentPartImageSchema,
  chatCompletionContentPartTextSchema,
  chatCompletionMessageParamSchema,
  chatCompletionOpenAIMessageParamSchema,
  chatCompletionMessageReasoningSchema,
} from "./openai/messages";
import { savedFunctionIdSchema } from "./function_id";
import { customTypes } from "./custom_types";

export {
  chatCompletionMessageParamSchema,
  chatCompletionContentPartSchema,
  chatCompletionContentPartImageSchema,
  chatCompletionContentPartTextSchema,
};
export {
  type ToolCall,
  messageRoleSchema,
  chatCompletionMessageReasoningSchema,
  chatCompletionMessageToolCallSchema,
  type MessageRole,
} from "./openai/messages";

export { toolsSchema } from "./openai/tools";
export type { Tools } from "./openai/tools";

export type OpenAIMessage = z.infer<
  typeof chatCompletionOpenAIMessageParamSchema
>;
export type Message = z.infer<typeof chatCompletionMessageParamSchema>;

export type Reasoning = z.infer<typeof chatCompletionMessageReasoningSchema>;

export type Content = Message["content"];
export type ContentPartText = z.infer<
  typeof chatCompletionContentPartTextSchema
>;
export type ContentPartImage = z.infer<
  typeof chatCompletionContentPartImageSchema
>;
export type ContentPart = z.infer<typeof chatCompletionContentPartSchema>;

export const promptBlockDataSchema = z.union([
  z
    .object({
      type: z.literal("completion"),
      content: z.string(),
    })
    .openapi({ title: "completion" }),
  z
    .object({
      type: z.literal("chat"),
      messages: z.array(chatCompletionMessageParamSchema),
      tools: z.string().optional(),
    })
    .openapi({ title: "chat" }),
]);

export type PromptBlockData = z.infer<typeof promptBlockDataSchema>;

// Note that for prompt options, we relax the strictness requirement because
// these params may come from external sources.

const braintrustModelParamsSchema = z.object({
  use_cache: z.boolean().optional(),
});
export const BRAINTRUST_PARAMS = Object.keys(braintrustModelParamsSchema.shape);

export const responseFormatJsonSchemaSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  schema: z
    .union([
      z.record(customTypes.unknown).openapi({ title: "object" }),
      z.string().openapi({ title: "string" }),
    ])
    .optional(),
  strict: z.boolean().nullish(),
});
export type ResponseFormatJsonSchema = z.infer<
  typeof responseFormatJsonSchemaSchema
>;

export const responseFormatSchema = z.union([
  z
    .object({ type: z.literal("json_object") })
    .openapi({ title: "json_object" }),
  z
    .object({
      type: z.literal("json_schema"),
      json_schema: responseFormatJsonSchemaSchema,
    })
    .openapi({ title: "json_schema" }),
  z.object({ type: z.literal("text") }).openapi({ title: "text" }),
]);

export const responsesAPIJsonSchemaSchema = z.object({
  type: z.literal("json_schema"),
  name: z.string(),
  description: z.string().optional(),
  schema: z
    .union([
      z.record(customTypes.unknown).openapi({ title: "object" }),
      z.string().openapi({ title: "string" }),
    ])
    .optional(),
  strict: z.boolean().nullish(),
});
export type ResponsesAPIJsonSchema = z.infer<
  typeof responsesAPIJsonSchemaSchema
>;

export const responsesAPIFormatSchema = z.union([
  z
    .object({ type: z.literal("json_object") })
    .openapi({ title: "json_object" }),
  responsesAPIJsonSchemaSchema.openapi({ title: "json_schema" }),
  z.object({ type: z.literal("text") }).openapi({ title: "text" }),
]);

const openAIModelParamsSchema = z.object({
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  max_completion_tokens: z
    .number()
    .optional()
    .describe("The successor to max_tokens"),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  response_format: responseFormatSchema.nullish(),
  tool_choice: z
    .union([
      z.literal("auto").openapi({ title: "auto" }),
      z.literal("none").openapi({ title: "none" }),
      z.literal("required").openapi({ title: "required" }),
      z
        .object({
          type: z.literal("function"),
          function: z.object({ name: z.string() }),
        })
        .openapi({ title: "function" }),
    ])
    .optional(),
  function_call: z
    .union([
      z.literal("auto").openapi({ title: "auto" }),
      z.literal("none").openapi({ title: "none" }),
      z
        .object({
          name: z.string(),
        })
        .openapi({ title: "function" }),
    ])
    .optional(),
  n: z.number().optional(),
  stop: z.array(z.string()).optional(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
});
export type OpenAIModelParams = z.infer<typeof openAIModelParamsSchema>;

const anthropicModelParamsSchema = z
  .object({
    max_tokens: z.number(),
    temperature: z.number(),
    top_p: z.number().optional(),
    top_k: z.number().optional(),
    stop_sequences: z.array(z.string()).optional(),
    max_tokens_to_sample: z
      .number()
      .optional()
      .describe("This is a legacy parameter that should not be used."),
  })
  .openapi("AntrhopicModelParams");
const googleModelParamsSchema = z
  .object({
    temperature: z.number().optional(),
    maxOutputTokens: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
  })
  .openapi("GoogleModelParams");
const windowAIModelParamsSchema = z
  .object({
    temperature: z.number().optional(),
    topK: z.number().optional(),
  })
  .openapi("WindowAIModelParams");
const jsCompletionParamsSchema = z.object({}).openapi("JsCompletionParams");
export const modelParamsSchema = z
  .union([
    braintrustModelParamsSchema
      .merge(openAIModelParamsSchema)
      .passthrough()
      .openapi({ title: "OpenAIModelParams" }),
    braintrustModelParamsSchema
      .merge(anthropicModelParamsSchema)
      .passthrough()
      .openapi({ title: "AnthropicModelParams" }),
    braintrustModelParamsSchema
      .merge(googleModelParamsSchema)
      .passthrough()
      .openapi({ title: "GoogleModelParams" }),
    braintrustModelParamsSchema
      .merge(windowAIModelParamsSchema)
      .passthrough()
      .openapi({ title: "WindowAIModelParams" }),
    braintrustModelParamsSchema
      .merge(jsCompletionParamsSchema)
      .passthrough()
      .openapi({ title: "JsCompletionParams" }),
  ])
  .openapi("ModelParams");

export type ModelParams = z.infer<typeof modelParamsSchema>;

const _anyModelParamsSchema = openAIModelParamsSchema
  .merge(anthropicModelParamsSchema)
  .merge(googleModelParamsSchema)
  .merge(braintrustModelParamsSchema);

export type AnyModelParam = z.infer<typeof _anyModelParamsSchema>;

export const promptOptionsSchema = z
  .object({
    model: z.string().optional(),
    params: modelParamsSchema.optional(),
    position: z.string().optional(),
  })
  .openapi("PromptOptions");

export type PromptOptions = z.infer<typeof promptOptionsSchema>;

const promptParserSchema = z.object({
  type: z.literal("llm_classifier"),
  use_cot: z.boolean(),
  choice_scores: z.record(z.number().min(0).max(1)),
});

export const promptDataSchema = z
  .object({
    prompt: promptBlockDataSchema.nullish(),
    options: promptOptionsSchema.nullish(),
    // This should be a union once we support multiple parser types
    parser: promptParserSchema.nullish(),
    tool_functions: z.array(savedFunctionIdSchema).nullish(),
    origin: z
      .object({
        prompt_id: z.string().optional(),
        project_id: z.string().optional(),
        prompt_version: z.string().optional(),
      })
      .nullish(),
  })
  .openapi("PromptData");

export type PromptData = z.infer<typeof promptDataSchema>;

// strictPromptDataSchema is extended from promptDataSchema to have stricter validation.
// It currently is only used when writing new prompts to preclude the creation of certain invalid or useless prompts.
export const strictPromptDataSchema = promptDataSchema.extend({
  parser: promptParserSchema
    .extend({
      choice_scores: promptParserSchema.shape.choice_scores.refine(
        (r) => Object.keys(r).length > 0,
        "choice_scores must be nonempty",
      ),
    })
    .nullish(),
});
