import { z } from "zod";

const chatCompletionSystemMessageParamSchema = z.object({
  content: z.string().default(""),
  role: z.literal("system"),
  name: z.string().optional(),
});

const chatCompletionContentPartTextSchema = z.object({
  text: z.string().default(""),
  type: z.literal("text"),
});

const functionCallSchema = z.object({
  arguments: z.string(),
  name: z.string(),
});

const functionSchema = z.object({
  arguments: z.string(),
  name: z.string(),
});

const imageURLSchema = z.object({
  url: z.string(),
  detail: z
    .union([z.literal("auto"), z.literal("low"), z.literal("high")])
    .optional(),
});

const chatCompletionToolMessageParamSchema = z.object({
  content: z.string().default(""),
  role: z.literal("tool"),
  tool_call_id: z.string(),
});

const chatCompletionFunctionMessageParamSchema = z.object({
  content: z.string().default(""),
  name: z.string(),
  role: z.literal("function"),
});

const chatCompletionContentPartImageSchema = z.object({
  image_url: imageURLSchema,
  type: z.literal("image_url"),
});

const chatCompletionMessageToolCallSchema = z.object({
  id: z.string(),
  function: functionSchema,
  type: z.literal("function"),
});

export const chatCompletionContentPartSchema = z.union([
  chatCompletionContentPartTextSchema,
  chatCompletionContentPartImageSchema,
]);

const chatCompletionContentPartsSchema = z.array(
  chatCompletionContentPartSchema
);

export const chatCompletionContentSchema = z.union([
  z.string().default(""),
  chatCompletionContentPartsSchema,
]);

const chatCompletionAssistantMessageParamSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().nullish(),
  function_call: functionCallSchema.optional(),
  name: z.string().optional(),
  tool_calls: z.array(chatCompletionMessageToolCallSchema).optional(),
});

const chatCompletionUserMessageParamSchema = z.object({
  content: chatCompletionContentSchema,
  role: z.literal("user"),
  name: z.string().optional(),
});

export const chatCompletionMessageParamSchema = z.union([
  chatCompletionSystemMessageParamSchema,
  chatCompletionUserMessageParamSchema,
  chatCompletionAssistantMessageParamSchema,
  chatCompletionToolMessageParamSchema,
  chatCompletionFunctionMessageParamSchema,
]);
