import { z } from "zod";
import { Prompt } from "./logger";
import {
  promptDefinitionWithToolsSchema,
  promptDefinitionToPromptData,
} from "./framework2";
import { promptDataSchema } from "@braintrust/core/typespecs";

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

export function validateParameters<
  Parameters extends EvalParameters = EvalParameters,
>(
  parameters: Record<string, unknown>,
  parameterSchema: Parameters,
): InferParameters<Parameters> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return Object.fromEntries(
    Object.entries(parameterSchema).map(([name, schema]) => {
      const value = parameters[name];
      try {
        if ("type" in schema && schema.type === "prompt") {
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
        } else {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const schemaCasted = schema as z.ZodSchema<unknown>;
          return [name, schemaCasted.parse(value)];
        }
      } catch (e) {
        console.error("Error validating parameter", name, e);
        throw Error(
          `Invalid parameter '${name}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),
  ) as InferParameters<Parameters>;
}
