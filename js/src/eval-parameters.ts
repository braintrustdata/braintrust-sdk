import { z } from "zod";
import { Prompt } from "./logger";
import { promptDefinitionSchema } from "./framework2";

// Schema for evaluation parameters
export const evalParametersSchema = z.record(
  z.string(),
  z.union([
    z.object({
      type: z.literal("prompt"),
      default: promptDefinitionSchema.optional(),
    }),
    z.instanceof(z.ZodType), // For Zod schemas
  ]),
);

export type EvalParameters = z.infer<typeof evalParametersSchema>;

// Type helper to infer the type of a parameter value
type InferParameterValue<T> = T extends { type: "prompt" }
  ? Prompt
  : T extends z.ZodType
    ? z.infer<T>
    : never;

// Type helper to infer the full parameters type
export type InferParameters<T extends EvalParameters> = {
  [K in keyof T]: InferParameterValue<T[K]>;
};
