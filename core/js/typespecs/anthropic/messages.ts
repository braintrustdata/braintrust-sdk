import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { cacheControlSchema } from "typespecs/openai/messages";
import { z } from "zod";

export const anthropicImageSourceSchema = z.object({
  type: z.literal("base64"),
  media_type: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  data: z.string(),
});

export const anthropicContentPartTextSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  cache_control: cacheControlSchema.optional(),
});

export const anthropicContentPartImageSchema = z.object({
  type: z.literal("image"),
  source: anthropicImageSourceSchema,
  cache_control: cacheControlSchema.optional(),
});

export const anthropicToolUseContentPartSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.any()),
  cache_control: cacheControlSchema.optional(),
});

export const anthropicToolResultContentPartSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z
    .union([
      z.string(),
      z.array(
        z.union([
          anthropicContentPartTextSchema,
          anthropicContentPartImageSchema,
        ]),
      ),
    ])
    .optional(),
  is_error: z.boolean().optional(),
  cache_control: cacheControlSchema.optional(),
});

export const anthropicContentPartSchema = z.union([
  anthropicContentPartTextSchema.openapi({ title: "text" }),
  anthropicContentPartImageSchema.openapi({ title: "image" }),
  anthropicToolUseContentPartSchema.openapi({ title: "tool_use" }),
  anthropicToolResultContentPartSchema.openapi({ title: "tool_result" }),
]);

const anthropicSystemMessageParamSchema = z.object({
  role: z.literal("system"),
  content: z.union([z.string(), z.array(anthropicContentPartTextSchema)]),
  cache_control: cacheControlSchema.optional(),
});

const anthropicUserMessageParamSchema = z.object({
  role: z.literal("user"),
  content: z.union([
    z.string(),
    z.array(
      z.union([
        anthropicContentPartTextSchema,
        anthropicContentPartImageSchema,
        anthropicToolResultContentPartSchema,
      ]),
    ),
  ]),
  cache_control: cacheControlSchema.optional(),
});

const anthropicAssistantMessageParamSchema = z.object({
  role: z.literal("assistant"),
  content: z.union([
    z.string(),
    z.array(
      z.union([
        anthropicContentPartTextSchema,
        anthropicToolUseContentPartSchema,
      ]),
    ),
  ]),
  cache_control: cacheControlSchema.optional(),
});

export const anthropicMessageParamSchema = z.union([
  anthropicSystemMessageParamSchema.openapi({ title: "system" }),
  anthropicUserMessageParamSchema.openapi({ title: "user" }),
  anthropicAssistantMessageParamSchema.openapi({ title: "assistant" }),
]);

export type AnthropicContentPart = z.infer<typeof anthropicContentPartSchema>;
export type AnthropicMessageParam = z.infer<typeof anthropicMessageParamSchema>;
