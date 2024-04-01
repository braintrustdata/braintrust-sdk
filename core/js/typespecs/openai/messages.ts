import { z } from "zod";

const chatCompletionSystemMessageParamSchema = z.strictObject({
  content: z.string().default(""),
  role: z.literal("system"),
  name: z.string().nullish(),
});

export const chatCompletionContentPartTextSchema = z.strictObject({
  text: z.string().default(""),
  type: z.literal("text"),
});

const imageURLSchema = z.strictObject({
  url: z.string(),
  detail: z
    .union([z.literal("auto"), z.literal("low"), z.literal("high")])
    .nullish(),
});

export const chatCompletionContentPartImageSchema = z.strictObject({
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

const chatCompletionUserMessageParamSchema = z.strictObject({
  content: chatCompletionContentSchema,
  role: z.literal("user"),
  name: z.string().nullish(),
});

const functionCallSchema = z.strictObject({
  arguments: z.string(),
  name: z.string(),
});

const functionSchema = z.strictObject({
  arguments: z.string(),
  name: z.string(),
});

const chatCompletionToolMessageParamSchema = z.strictObject({
  content: z.string().default(""),
  role: z.literal("tool"),
  tool_call_id: z.string(),
});

const chatCompletionFunctionMessageParamSchema = z.strictObject({
  content: z.string().default(""),
  name: z.string(),
  role: z.literal("function"),
});

const chatCompletionMessageToolCallSchema = z.strictObject({
  id: z.string(),
  function: functionSchema,
  type: z.literal("function"),
});

const chatCompletionAssistantMessageParamSchema = z.strictObject({
  role: z.literal("assistant"),
  content: z.string().nullish(),
  function_call: functionCallSchema.nullish(),
  name: z.string().nullish(),
  tool_calls: z.array(chatCompletionMessageToolCallSchema).nullish(),
});

export const chatCompletionMessageParamSchema = z.union([
  chatCompletionSystemMessageParamSchema,
  chatCompletionUserMessageParamSchema,
  chatCompletionAssistantMessageParamSchema,
  chatCompletionToolMessageParamSchema,
  chatCompletionFunctionMessageParamSchema,
]);
