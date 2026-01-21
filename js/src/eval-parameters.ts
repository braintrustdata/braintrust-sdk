import { z } from "zod/v3";
import type { Prompt, ParameterSet } from "./logger";
import type { PromptDefinitionWithTools } from "./framework2";

// Schema for evaluation parameters - defined inline to avoid runtime import from framework2
export const evalParametersSchema = z.record(
  z.string(),
  z.union([
    z.object({
      type: z.literal("prompt"),
      default: z.unknown().optional(),
      description: z.string().optional(),
    }),
    z.instanceof(z.ZodType), // For Zod schemas
  ]),
);

/** The schema type for evaluation parameters (what gets validated/transformed) */
export type EvalParameters = z.infer<typeof evalParametersSchema>;

/**
 * Helper type to extract the schema type from either:
 * - A direct schema (EvalParameters)
 * - A Promise of schema
 * - A Promise of ParameterSet (extract __schema)
 */
export type ExtractSchema<P> =
  P extends ParameterSet<infer _T, infer S>
    ? S
    : P extends Promise<ParameterSet<infer _T, infer S>>
      ? S
      : P extends Promise<infer U>
        ? U extends EvalParameters
          ? U
          : EvalParameters
        : P extends EvalParameters
          ? P
          : EvalParameters;

// Type helper to infer the type of a parameter value
type InferParameterValue<T> = T extends { type: "prompt" }
  ? Prompt
  : T extends z.ZodType
    ? z.infer<T>
    : T;

// Type helper to infer the full parameters type
export type InferParameters<T extends EvalParameters> = {
  [K in keyof T]: InferParameterValue<T[K]>;
};
