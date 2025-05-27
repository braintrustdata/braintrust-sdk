import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
extendZodWithOpenApi(z);

export const messageRoleSchema = z
  .enum(["system", "user", "assistant", "function", "tool", "model"])
  .openapi("MessageRole");
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const cacheControlSchema = z.object({
  type: z.enum(["ephemeral"]),
});

export const chatCompletionContentPartTextSchema = z
  .object({
    text: z.string().default(""),
    type: z.literal("text"),
    cache_control: cacheControlSchema.optional(),
  })
  .openapi("ChatCompletionContentPartText");

const chatCompletionSystemMessageParamSchema = z.object({
  content: z.union([
    z.string().default("").openapi({ title: "text" }),
    z.array(chatCompletionContentPartTextSchema).openapi({ title: "array" }),
  ]),
  role: z.literal("system"),
  name: z.string().optional(),
});

const imageURLSchema = z.object({
  url: z.string(),
  detail: z
    .union([
      z.literal("auto").openapi({ title: "auto" }),
      z.literal("low").openapi({ title: "low" }),
      z.literal("high").openapi({ title: "high" }),
    ])
    .optional(),
});

export const chatCompletionContentPartImageSchema = z
  .object({
    image_url: imageURLSchema,
    type: z.literal("image_url"),
  })
  .openapi("ChatCompletionContentPartImage");

export const anthropicImageSourceSchema = z.object({
  type: z.literal("base64"),
  media_type: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  data: z.string(),
});

export const anthropicContentPartTextSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    cache_control: cacheControlSchema.optional(),
  })
  .openapi("AnthropicContentPartText");

export const anthropicContentPartImageSchema = z
  .object({
    type: z.literal("image"),
    source: anthropicImageSourceSchema,
    cache_control: cacheControlSchema.optional(),
  })
  .openapi("AnthropicContentPartImage");

export const anthropicToolUseContentPartSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.any()),
    cache_control: cacheControlSchema.optional(),
  })
  .openapi("AnthropicToolUseContentPart");

export const anthropicToolResultContentPartSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z
      .array(
        z.union([
          anthropicContentPartTextSchema,
          anthropicContentPartImageSchema,
        ]),
      )
      .optional(),
    is_error: z.boolean().optional(),
    cache_control: cacheControlSchema.optional(),
  })
  .openapi("AnthropicToolResultContentPart");

export const anthropicContentPartSchema = z
  .union([
    anthropicContentPartTextSchema.openapi({ title: "text" }),
    anthropicContentPartImageSchema.openapi({ title: "image" }),
    anthropicToolUseContentPartSchema.openapi({ title: "tool_use" }),
    anthropicToolResultContentPartSchema.openapi({ title: "tool_result" }),
  ])
  .openapi("AnthropicContentPart");

export const chatCompletionContentPartSchema = z
  .union([
    chatCompletionContentPartTextSchema.openapi({ title: "text" }),
    chatCompletionContentPartImageSchema.openapi({ title: "image_url" }),
  ])
  .openapi("ChatCompletionContentPart");

export const chatCompletionContentSchema = z
  .union([
    z.string().default("").openapi({ title: "text" }),
    z
      .array(
        chatCompletionContentPartSchema.openapi({
          title: "chat_completion_content_part",
        }),
      )
      .openapi({ title: "array" }),
  ])
  .openapi("ChatCompletionContent");

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

export const anthropicMessageParamSchema = z
  .union([
    anthropicSystemMessageParamSchema.openapi({ title: "system" }),
    anthropicUserMessageParamSchema.openapi({ title: "user" }),
    anthropicAssistantMessageParamSchema.openapi({ title: "assistant" }),
  ])
  .openapi("AnthropicMessageParam");

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
  content: z.union([
    z.string().default("").openapi({ title: "text" }),
    z.array(chatCompletionContentPartTextSchema).openapi({ title: "array" }),
  ]),
  role: z.literal("tool"),
  tool_call_id: z.string().default(""),
});

const chatCompletionFunctionMessageParamSchema = z.object({
  content: z.string().nullable(),
  name: z.string(),
  role: z.literal("function"),
});

export const chatCompletionMessageToolCallSchema = z
  .object({
    id: z.string(),
    function: functionSchema,
    type: z.literal("function"),
  })
  .openapi("ChatCompletionMessageToolCall");

export const chatCompletionMessageReasoningSchema = z
  .object({
    id: z
      .string()
      .nullish()
      .transform((x) => x ?? undefined),
    content: z
      .string()
      .nullish()
      .transform((x) => x ?? undefined),
  })
  .describe(
    "Note: This is not part of the OpenAI API spec, but we added it for interoperability with multiple reasoning models.",
  )
  .openapi("ChatCompletionMessageReasoning");

const chatCompletionAssistantMessageParamSchema = z.object({
  role: z.literal("assistant"),
  content: z
    .union([z.string(), z.array(chatCompletionContentPartTextSchema)])
    .nullish(),
  // NOTE: It's important to keep these optional, rather than nullish, to stay
  // inline with the OpenAI SDK's type definition.
  function_call: functionCallSchema.nullish().transform((x) => x ?? undefined),
  name: z
    .string()
    .nullish()
    .transform((x) => x ?? undefined),
  tool_calls: z
    .array(chatCompletionMessageToolCallSchema)
    .nullish()
    .transform((x) => x ?? undefined),
  reasoning: z
    .array(chatCompletionMessageReasoningSchema)
    .nullish()
    .transform((x) => x ?? undefined),
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
  chatCompletionSystemMessageParamSchema.openapi({ title: "system" }),
  chatCompletionUserMessageParamSchema.openapi({ title: "user" }),
  chatCompletionAssistantMessageParamSchema.openapi({ title: "assistant" }),
  chatCompletionToolMessageParamSchema.openapi({ title: "tool" }),
  chatCompletionFunctionMessageParamSchema.openapi({ title: "function" }),
]);

export const chatCompletionMessageParamSchema = z
  .union([
    chatCompletionOpenAIMessageParamSchema.openapi({ title: "openai" }),
    anthropicMessageParamSchema.openapi({ title: "anthropic" }),
    chatCompletionFallbackMessageParamSchema.openapi({ title: "fallback" }),
  ])
  .openapi("ChatCompletionMessageParam");

export const anthropicToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.record(z.any()), // JSON Schema for the tool's input
  cache_control: cacheControlSchema.optional(),
});

export const anthropicToolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("any"),
  z.object({
    type: z.literal("tool"),
    name: z.string(),
  }),
]);

export type ToolCall = z.infer<typeof chatCompletionMessageToolCallSchema>;
export type AnthropicContentPart = z.infer<typeof anthropicContentPartSchema>;
export type AnthropicMessageParam = z.infer<typeof anthropicMessageParamSchema>;
export type AnthropicTool = z.infer<typeof anthropicToolSchema>;
export type AnthropicToolChoice = z.infer<typeof anthropicToolChoiceSchema>;
