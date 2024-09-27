import { z } from "zod";

export const savedFunctionIdSchema = z.union([
  z
    .object({
      type: z.literal("function"),
      id: z.string(),
    })
    .openapi({ title: "function" }),
  z
    .object({
      type: z.literal("global"),
      name: z.string(),
    })
    .openapi({ title: "global" }),
]);

export type SavedFunctionId = z.infer<typeof savedFunctionIdSchema>;

export const extendedSavedFunctionIdSchema = savedFunctionIdSchema.or(
  z.object({
    type: z.literal("slug"),
    project_id: z.string(),
    slug: z.string(),
  }),
);

export type ExtendedSavedFunctionId = z.infer<
  typeof extendedSavedFunctionIdSchema
>;
