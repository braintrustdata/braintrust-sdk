import { z } from "zod";
import {
  chatCompletionContentPartSchema,
  chatCompletionContentPartImageSchema,
  chatCompletionContentPartTextSchema,
  chatCompletionMessageParamSchema,
  chatCompletionOpenAIMessageParamSchema,
} from "./openai/messages";
import { savedFunctionIdSchema } from "./function_id";
export {
  ToolCall,
  messageRoleSchema,
  chatCompletionMessageToolCallSchema,
  MessageRole,
} from "./openai/messages";
export { chatCompletionContentPartImageSchema };

export { toolsSchema } from "./openai/tools";
export type { Tools } from "./openai/tools";

export type OpenAIMessage = z.infer<
  typeof chatCompletionOpenAIMessageParamSchema
>;
export type Message = z.infer<typeof chatCompletionMessageParamSchema>;

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

const openAIModelParamsSchema = z.object({
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  response_format: z.object({ type: z.literal("json_object") }).nullish(),
  tool_choice: z
    .union([
      z.literal("auto").openapi({ title: "auto" }),
      z.literal("none").openapi({ title: "none" }),
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
});
export type OpenAIModelParams = z.infer<typeof openAIModelParamsSchema>;

const anthropicModelParamsSchema = z.object({
  max_tokens: z.number(),
  temperature: z.number(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  stop_sequences: z.array(z.string()).optional(),
  max_tokens_to_sample: z
    .number()
    .optional()
    .describe("This is a legacy parameter that should not be used."),
});
const googleModelParamsSchema = z.object({
  temperature: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
});
const windowAIModelParamsSchema = z.object({
  temperature: z.number().optional(),
  topK: z.number().optional(),
});
const jsCompletionParamsSchema = z.object({});
export const modelParamsSchema = z.union([
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
]);

export type ModelParams = z.infer<typeof modelParamsSchema>;

const anyModelParamsSchema = openAIModelParamsSchema
  .merge(anthropicModelParamsSchema)
  .merge(googleModelParamsSchema)
  .merge(braintrustModelParamsSchema);

export type AnyModelParam = z.infer<typeof anyModelParamsSchema>;

export const promptOptionsSchema = z.object({
  model: z.string().optional(),
  params: modelParamsSchema.optional(),
  position: z.string().optional(),
});

export type PromptOptions = z.infer<typeof promptOptionsSchema>;

export const promptDataSchema = z
  .object({
    prompt: promptBlockDataSchema.nullish(),
    options: promptOptionsSchema.nullish(),
    // This should be a union once we support multiple parser types
    parser: z
      .object({
        type: z.literal("llm_classifier"),
        use_cot: z.boolean(),
        choice_scores: z.record(z.number().min(0).max(1)),
      })
      .nullish(),
    structured_tools: z.array(savedFunctionIdSchema).nullish(),
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
