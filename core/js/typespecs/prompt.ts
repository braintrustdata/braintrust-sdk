import { z } from "zod";
import {
  chatCompletionContentPartSchema,
  chatCompletionContentPartImageSchema,
  chatCompletionContentPartTextSchema,
  chatCompletionMessageParamSchema,
  chatCompletionOpenAIMessageParamSchema,
} from "./openai/messages";
export { ToolCall, messageRoleSchema, MessageRole } from "./openai/messages";
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
  response_format: z.strictObject({ type: z.literal("json_object") }).nullish(),
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
  braintrustModelParamsSchema.merge(openAIModelParamsSchema).passthrough(),
  braintrustModelParamsSchema.merge(anthropicModelParamsSchema).passthrough(),
  braintrustModelParamsSchema.merge(googleModelParamsSchema).passthrough(),
  braintrustModelParamsSchema.merge(windowAIModelParamsSchema).passthrough(),
  braintrustModelParamsSchema.merge(jsCompletionParamsSchema).passthrough(),
]);

export type ModelParams = z.infer<typeof modelParamsSchema>;

const anyModelParamsSchema = openAIModelParamsSchema
  .merge(anthropicModelParamsSchema)
  .merge(googleModelParamsSchema)
  .merge(braintrustModelParamsSchema)
  .merge(windowAIModelParamsSchema);

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
