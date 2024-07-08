import { z } from "zod";

export const messageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "function",
  "tool",
  "model",
]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

const chatCompletionSystemMessageParamSchema = z.object({
  content: z.string().default(""),
  role: z.literal("system"),
  name: z.string().optional(),
});
export const chatCompletionContentPartTextSchema = z.object({
  text: z.string().default(""),
  type: z.literal("text"),
});

const imageURLSchema = z.object({
  url: z.string(),
  detail: z
    .union([z.literal("auto"), z.literal("low"), z.literal("high")])
    .optional(),
});
export const chatCompletionContentPartImageSchema = z.object({
  image_url: imageURLSchema,
  type: z.literal("image_url"),
});

export const chatCompletionContentPartSchema = z.union([
  chatCompletionContentPartTextSchema,
  chatCompletionContentPartImageSchema,
]);

export const chatCompletionContentSchema = z.union([
  z.string().default(""),
  z.array(chatCompletionContentPartSchema),
]);

const chatCompletionUserMessageParamSchema = z.object({
  content: chatCompletionContentSchema,
  role: z.literal("user"),
  name: z.string().optional(),
});
const functionCallSchema = z.object({
  arguments: z.string(),
  name: z.string(),
});
const functionSchema = z.object({
  arguments: z.string(),
  name: z.string(),
});
const chatCompletionToolMessageParamSchema = z.object({
  content: z.string().default(""),
  role: z.literal("tool"),
  tool_call_id: z.string().default(""),
});
const chatCompletionFunctionMessageParamSchema = z.object({
  content: z.string().default(""),
  name: z.string(),
  role: z.literal("function"),
});
export const chatCompletionMessageToolCallSchema = z.object({
  id: z.string(),
  function: functionSchema,
  type: z.literal("function"),
});

const chatCompletionAssistantMessageParamSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().nullish(),
  function_call: functionCallSchema.optional(),
  name: z.string().optional(),
  tool_calls: z.array(chatCompletionMessageToolCallSchema).optional(),
});
const chatCompletionFallbackMessageParamSchema = z.object({
  role: messageRoleSchema.exclude([
    "system",
    "user",
    "assistant",
    "tool",
    "function",
  ]),
  content: z.string().nullish(),
});
export const chatCompletionOpenAIMessageParamSchema = z.union([
  chatCompletionSystemMessageParamSchema,
  chatCompletionUserMessageParamSchema,
  chatCompletionAssistantMessageParamSchema,
  chatCompletionToolMessageParamSchema,
  chatCompletionFunctionMessageParamSchema,
]);

export const chatCompletionMessageParamSchema = z.union([
  chatCompletionOpenAIMessageParamSchema,
  chatCompletionFallbackMessageParamSchema,
]);

export type ToolCall = z.infer<typeof chatCompletionMessageToolCallSchema>;
