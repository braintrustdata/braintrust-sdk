import { Prompt } from "./logger";
import type { ZodSchema } from "./zod/utils";
import {
  promptDefinitionToPromptData,
  type PromptDefinitionWithTools,
} from "./prompt-schemas";
import { PromptData as promptDataSchema } from "./sdk-schemas";

export type EvalParameters = Record<
  string,
  | {
      type: "prompt";
      default?: PromptDefinitionWithTools;
      description?: string;
    }
  | {
      type: "model";
      default?: string;
      description?: string;
    }
  | ZodSchema
>;

type InferParameterValue<T> = T extends { type: "prompt" }
  ? Prompt<boolean, boolean>
  : T extends { type: "model" }
    ? string
    : T extends ZodSchema
      ? T["_output"]
      : never;

export type InferParameters<T extends EvalParameters> = {
  [K in keyof T]: InferParameterValue<T[K]>;
};

export function validateParameters<Parameters extends EvalParameters>(
  parameters: Record<string, unknown>,
  parameterSchema?: Parameters,
): InferParameters<Parameters> {
  if (!parameterSchema) {
    return parameters as InferParameters<Parameters>;
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return Object.fromEntries(
    Object.entries(parameterSchema).map(([name, schema]) => {
      const value = parameters[name];
      try {
        if ("type" in schema && schema.type === "prompt") {
          if (Prompt.isPrompt(value)) {
            return [name, value];
          }
          let promptData;
          if (value) {
            promptData = promptDataSchema.parse(value);
          } else if (schema.default) {
            promptData = promptDefinitionToPromptData(
              schema.default,
              schema.default.tools,
            );
          } else {
            throw new Error(`Parameter '${name}' is required`);
          }
          return [name, Prompt.fromPromptData(name, promptData)];
        }

        if ("type" in schema && schema.type === "model") {
          const model = value ?? schema.default;
          if (model === undefined) {
            throw new Error(`Parameter '${name}' is required`);
          }
          if (typeof model !== "string") {
            throw new Error(
              `Parameter '${name}' must be a string model identifier`,
            );
          }
          return [name, model];
        }

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const zodSchema = schema as ZodSchema;
        return [name, zodSchema.parse(value)];
      } catch (e) {
        // eslint-disable-next-line no-restricted-properties -- preserving intentional console usage.
        console.error("Error validating parameter", name, e);
        throw Error(
          `Invalid parameter '${name}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),
  ) as InferParameters<Parameters>;
}
