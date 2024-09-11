import { z } from "zod";

export const savedFunctionIdSchema = z.union([
  z.object({
    type: z.literal("function"),
    id: z.string(),
  }),
  z.object({
    type: z.literal("global"),
    name: z.string(),
  }),
]);

export type SavedFunctionId = z.infer<typeof savedFunctionIdSchema>;
