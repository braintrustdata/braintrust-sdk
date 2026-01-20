import { z } from "zod/v3";
import { Prompt } from "./logger";
import type { ParameterSet } from "./logger";
import {
  promptDefinitionWithToolsSchema,
  promptDefinitionToPromptData,
  type PromptDefinitionWithTools,
} from "./framework2";
import { PromptData as promptDataSchema } from "./generated_types";

// Type for a prompt parameter definition
interface PromptParameterDef {
  type: "prompt";
  default?: PromptDefinitionWithTools;
  description?: string;
}

// Type guard for prompt parameter definitions
function isPromptParameterDef(value: unknown): value is PromptParameterDef {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "prompt"
  );
}

// Check if a value looks like a Zod schema
function isZodSchema(value: unknown): value is z.ZodType {
  if (value === null || typeof value !== "object") {
    return false;
  }
  // Zod schemas have specific internal properties
  return (
    "_def" in value || // Zod v3
    "_zod" in value || // Zod v4
    ("parse" in value &&
      typeof value.parse === "function" &&
      "safeParse" in value &&
      typeof value.safeParse === "function")
  );
}

// Schema for evaluation parameters
export const evalParametersSchema = z.record(
  z.string(),
  z.union([
    z.object({
      type: z.literal("prompt"),
      default: promptDefinitionWithToolsSchema.optional(),
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

// Overload for typed schema
export function validateParameters<
  Parameters extends EvalParameters = EvalParameters,
>(
  parameters: Record<string, unknown>,
  parameterSchema: Parameters,
): InferParameters<Parameters>;
// Overload for untyped/unknown schema
export function validateParameters(
  parameters: Record<string, unknown>,
  parameterSchema: unknown,
): Record<string, unknown>;
// Implementation
export function validateParameters(
  parameters: Record<string, unknown>,
  parameterSchema: unknown,
): Record<string, unknown> {
  if (!parameterSchema || typeof parameterSchema !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parameterSchema).map(([name, schema]) => {
      const value = parameters[name];
      try {
        // Check if this is a prompt parameter definition
        if (isPromptParameterDef(schema)) {
          const promptData = value
            ? promptDataSchema.parse(value)
            : schema.default
              ? promptDefinitionToPromptData(
                  schema.default,
                  schema.default.tools,
                )
              : undefined;
          if (!promptData) {
            throw new Error(`Parameter '${name}' is required`);
          }
          return [name, Prompt.fromPromptData(name, promptData)];
        }

        // Check if this is a Zod schema
        if (isZodSchema(schema)) {
          return [name, schema.parse(value)];
        }

        // Raw value (e.g. from loadParameters) - use provided value or default to schema value
        return [name, value ?? schema];
      } catch (e) {
        console.error("Error validating parameter", name, e);
        throw Error(
          `Invalid parameter '${name}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),
  );
}
