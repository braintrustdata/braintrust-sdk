import { z } from "zod";

export const promptBlockDataSchema = z.union([
  z.object({
    type: z.literal("completion"),
    content: z.string().default(""),
  }),
  z.object({
    type: z.literal("chat"),
    messages: z.array(messageSchema),
    tools: z.string().optional(),
  }),
]);

export type PromptBlockData = z.infer<typeof promptBlockDataSchema>;

export const promptOptionsSchema = z.object({
  model: z.string().optional(),
  params: modelParamsSchema.optional(),
  position: z.string().optional(),
});

export type PromptOptions = z.infer<typeof promptOptionsSchema>;

export const promptDataSchema = z.object({
  prompt: promptBlockDataSchema.nullish(),
  options: promptOptionsSchema,
  origin: z
    .object({
      prompt_id: z.string().optional(),
      prompt_version: z.string().optional(),
    })
    .nullish(),
});

export type PromptData = z.infer<typeof promptDataSchema>;
