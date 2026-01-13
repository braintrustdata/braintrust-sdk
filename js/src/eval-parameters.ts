import { z } from "zod/v3";
import { Config, Prompt } from "./logger";
import { promptDefinitionToPromptData } from "./framework2";
import { PromptData as promptDataSchema } from "./generated_types";

/**
 * Type definition for evaluation parameters.
 * Can be either:
 * - A prompt parameter definition: { type: "prompt", default?: PromptDefinition, description?: string }
 * - A Zod schema for data validation
 */
export type EvalParameters = Record<
  string,
  | { type: "prompt"; default?: unknown; description?: string }
  | z.ZodType<unknown>
>;

// Type helper to infer the type of a parameter value
type InferParameterValue<T> = T extends { type: "prompt" }
  ? Prompt
  : T extends z.ZodType
    ? z.infer<T>
    : T;

// Type helper to infer the full parameters type
export type InferParameters<T> = {
  [K in keyof T]: InferParameterValue<T[K]>;
};

/**
 * Helper type to extract resolved parameters from various input types.
 * This handles:
 * - Direct schema with Zod types -> inferred values
 * - loadConfig result -> already resolved
 * - Promise of either
 */
export type ResolveParameters<T> =
  T extends Promise<infer R> ? ResolveParameters<R> : InferParameters<T>;

// Check if a value looks like a Zod schema
function isZodSchema(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  // Zod schemas have specific internal properties
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = value as any;
  return (
    "_def" in v || // Zod v3
    "_zod" in v || // Zod v4
    (typeof v.parse === "function" && typeof v.safeParse === "function")
  );
}

export function validateParameters<
  Parameters extends EvalParameters = EvalParameters,
>(
  parameters: Record<string, unknown>,
  parameterSchema:
    | Parameters
    | Record<string, unknown>
    | Config<Record<string, unknown>>,
): InferParameters<Parameters> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return Object.fromEntries(
    Object.entries(parameterSchema).map(([name, schema]) => {
      const value = parameters[name];
      try {
        // Check if this is a prompt parameter definition
        if (
          schema !== null &&
          typeof schema === "object" &&
          "type" in schema &&
          schema.type === "prompt"
        ) {
          const promptData = value
            ? promptDataSchema.parse(value)
            : // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (schema as any).default
              ? promptDefinitionToPromptData(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (schema as any).default,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (schema as any).default.tools,
                )
              : undefined;
          if (!promptData) {
            throw new Error(`Parameter '${name}' is required`);
          }
          return [name, Prompt.fromPromptData(name, promptData)];
        }

        // Check if this is a Zod schema
        if (isZodSchema(schema)) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const schemaCasted = schema as z.ZodSchema<unknown>;
          return [name, schemaCasted.parse(value)];
        }

        // Raw value (e.g. from loadConfig) - use provided value or default to schema value
        return [name, value ?? schema];
      } catch (e) {
        console.error("Error validating parameter", name, e);
        throw Error(
          `Invalid parameter '${name}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),
  ) as InferParameters<Parameters>;
}
