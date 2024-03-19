import { z } from "zod";
import {
  chatCompletionContentPartSchema,
  chatCompletionContentPartImageSchema,
  chatCompletionContentPartTextSchema,
  chatCompletionMessageParamSchema,
} from "./openai/messages";
export { chatCompletionContentPartImageSchema };

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
export type Content = Message["content"];
export type ContentPartText = z.infer<
  typeof chatCompletionContentPartTextSchema
>;
export type ContentPartImage = z.infer<
  typeof chatCompletionContentPartImageSchema
>;
export type ContentPart = z.infer<typeof chatCompletionContentPartSchema>;

export const promptBlockDataSchema = z.union([
  z.object({
    type: z.literal("completion"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("chat"),
    messages: z.array(chatCompletionMessageParamSchema),
    tools: z.string().optional(),
  }),
]);

export type PromptBlockData = z.infer<typeof promptBlockDataSchema>;

const braintrustModelParamsSchema = z.object({
  use_cache: z.boolean().optional(),
});

export const BRAINTRUST_PARAMS = Object.keys(braintrustModelParamsSchema.shape);

const openAIModelParamsSchema = z.object({
  temperature: z.number(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  response_format: z
    .union([z.literal(null), z.object({ type: z.literal("json_object") })])
    .optional(),
  tool_choice: z
    .union([
      z.literal("auto"),
      z.literal("none"),
      z.object({
        type: z.literal("function"),
        function: z.object({ name: z.string() }),
      }),
    ])
    .optional(),
});

export type OpenAIModelParams = z.infer<typeof openAIModelParamsSchema>;

const anthropicModelParamsSchema = z.object({
  max_tokens: z.number(),
  temperature: z.number(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  max_tokens_to_sample: z
    .number()
    .optional()
    .describe("This is a legacy parameter that should not be used."),
});

const googleModelParamsSchema = z.object({
  temperature: z.number(),
  maxOutputTokens: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
});

const jsCompletionParamsSchema = z.object({});
export const modelParamsSchema = braintrustModelParamsSchema.and(
  z.union([
    openAIModelParamsSchema,
    anthropicModelParamsSchema,
    googleModelParamsSchema,
    jsCompletionParamsSchema,
  ])
);

export type ModelParams = z.infer<typeof modelParamsSchema>;

const anyModelParamsSchema = openAIModelParamsSchema
  .and(anthropicModelParamsSchema)
  .and(googleModelParamsSchema)
  .and(braintrustModelParamsSchema);

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
      .object({
        prompt_id: z.string().optional(),
        prompt_version: z.string().optional(),
      })
      .nullish(),
  })
  .openapi("PromptData");

export type PromptData = z.infer<typeof promptDataSchema>;
