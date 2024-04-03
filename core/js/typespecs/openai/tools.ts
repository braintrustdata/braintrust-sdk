import { z } from "zod";

export const functionParametersSchema = z.record(z.unknown());

export const functionDefinitionSchema = z
  .strictObject({
    name: z.string(),
    description: z.string().optional(),
    parameters: functionParametersSchema.optional(),
  })
  .strip();

export const chatCompletionToolSchema = z
  .strictObject({
    function: functionDefinitionSchema,
    type: z.literal("function"),
  })
  .strip();

export const toolsSchema = z.array(chatCompletionToolSchema);
export type Tools = z.infer<typeof toolsSchema>;
