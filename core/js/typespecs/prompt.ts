import { z } from "zod";
import { promptRowSchema } from "./app_types";

export const messageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "function",
  "tool",
  "model",
]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const functionCallSchema = z.object({
  name: z.string(),
  arguments: z.string(),
});

const toolCallSchema = z.object({
  id: z.string(),
  function: z.object({
    arguments: z.string(),
    name: z.string(),
  }),
  type: z.literal("function"),
});

export const messageSchema = z.object({
  content: z.string().default(""),
  role: messageRoleSchema,
  name: z.string().optional(),
  function_call: z.union([z.string(), functionCallSchema]).optional(),
  tool_calls: z.array(toolCallSchema).optional(),
});
export type Message = z.infer<typeof messageSchema>;

export const promptBlockDataSchema = z.union([
  z.object({
    type: z.literal("completion"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("chat"),
    messages: z.array(messageSchema),
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

export const promptSchema = promptRowSchema.omit({ project_id: true }).and(
  z.object({
    _xact_id: z.string(),
  })
);
export type Prompt = z.infer<typeof promptSchema>;
