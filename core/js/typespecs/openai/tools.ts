import { z } from "zod";

export const functionParametersSchema = z.record(z.unknown());

export const functionDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: functionParametersSchema.optional(),
});

export const chatCompletionToolSchema = z.object({
  function: functionDefinitionSchema,
  type: z.literal("function"),
});

export const toolsSchema = z.array(chatCompletionToolSchema);
export type Tools = z.infer<typeof toolsSchema>;
