import { z } from "zod";
import {
  chatCompletionAssistantMessageParamSchema,
  chatCompletionContentPartSchema,
  chatCompletionContentPartImageSchema,
  chatCompletionContentPartTextSchema,
  chatCompletionMessageParamSchema,
} from "./openai/messages";
export { ToolCall } from "./openai/messages";
export {
  chatCompletionAssistantMessageParamSchema,
  chatCompletionContentPartImageSchema,
  chatCompletionMessageParamSchema,
};

export { toolsSchema } from "./openai/tools";
export type { Tools } from "./openai/tools";

export const messageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "function",
  "tool",
  "model",
]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export type Message = z.infer<typeof chatCompletionMessageParamSchema>;
export type AssistantMessage = z.infer<
  typeof chatCompletionAssistantMessageParamSchema
>;
export type Content = Message["content"];
export type ContentPartText = z.infer<
  typeof chatCompletionContentPartTextSchema
>;
export type ContentPartImage = z.infer<
  typeof chatCompletionContentPartImageSchema
>;
export type ContentPart = z.infer<typeof chatCompletionContentPartSchema>;

export const promptBlockDataSchema = z.union([
  z.strictObject({
    type: z.literal("completion"),
    content: z.string(),
  }),
  z.strictObject({
    type: z.literal("chat"),
    messages: z.array(chatCompletionMessageParamSchema),
    tools: z.string().optional(),
  }),
]);

export type PromptBlockData = z.infer<typeof promptBlockDataSchema>;

// Note that for prompt options, we relax the strictness requirement because
// these params may come from external sources.

const braintrustModelParamsSchema = z
  .strictObject({
    use_cache: z.boolean().optional(),
  })
  .strip();

export const BRAINTRUST_PARAMS = Object.keys(braintrustModelParamsSchema.shape);

const openAIModelParamsSchema = z
  .strictObject({
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().optional(),
    frequency_penalty: z.number().optional(),
    presence_penalty: z.number().optional(),
    response_format: z
      .strictObject({ type: z.literal("json_object") })
      .nullish(),
    tool_choice: z
      .union([
        z.literal("auto"),
        z.literal("none"),
        z
          .strictObject({
            type: z.literal("function"),
            function: z.strictObject({ name: z.string() }).strip(),
          })
          .strip(),
      ])
      .optional(),
    function_call: z
      .union([
        z.literal("auto"),
        z.literal("none"),
        z.strictObject({
          name: z.string(),
        }),
      ])
      .optional(),
    n: z.number().optional(),
    stop: z.array(z.string()).optional(),
  })
  .strip();

export type OpenAIModelParams = z.infer<typeof openAIModelParamsSchema>;

const anthropicModelParamsSchema = z
  .strictObject({
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
  .strip();

const googleModelParamsSchema = z
  .strictObject({
    temperature: z.number(),
    maxOutputTokens: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
  })
  .strip();

const jsCompletionParamsSchema = z.strictObject({}).strip();
export const modelParamsSchema = z.union([
  braintrustModelParamsSchema.merge(openAIModelParamsSchema),
  braintrustModelParamsSchema.merge(anthropicModelParamsSchema),
  braintrustModelParamsSchema.merge(googleModelParamsSchema),
  braintrustModelParamsSchema.merge(jsCompletionParamsSchema),
]);

export type ModelParams = z.infer<typeof modelParamsSchema>;

const anyModelParamsSchema = openAIModelParamsSchema
  .merge(anthropicModelParamsSchema)
  .merge(googleModelParamsSchema)
  .merge(braintrustModelParamsSchema);

export type AnyModelParam = z.infer<typeof anyModelParamsSchema>;

export const promptOptionsSchema = z
  .strictObject({
    model: z.string().optional(),
    params: modelParamsSchema.optional(),
    position: z.string().optional(),
  })
  .strip();

export type PromptOptions = z.infer<typeof promptOptionsSchema>;

export const promptDataSchema = z
  .strictObject({
    prompt: promptBlockDataSchema.nullish(),
    options: promptOptionsSchema.nullish(),
    origin: z
      .strictObject({
        prompt_id: z.string().optional(),
        project_id: z.string().optional(),
        prompt_version: z.string().optional(),
      })
      .nullish(),
  })
  .openapi("PromptData");

export type PromptData = z.infer<typeof promptDataSchema>;
