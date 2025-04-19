import {
  functionIdSchema,
  invokeParent,
  runEvalSchema,
  promptDataSchema,
} from "@braintrust/core/typespecs";
import { z } from "zod";
import { EvaluatorDef } from "../framework";
import { BaseMetadata } from "../logger";
import { EvalParameters } from "../eval-parameters";
import zodToJsonSchema from "zod-to-json-schema";
import { promptDefinitionToPromptData } from "../framework2";

export const evalBodySchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.unknown()).nullish(),
  data: runEvalSchema.shape.data,
  scores: z
    .array(
      z.object({
        function_id: functionIdSchema,
        name: z.string(),
      }),
    )
    .nullish(),
  parent: invokeParent.optional(),
});

export type EvaluatorManifest = Record<
  string,
  EvaluatorDef<unknown, unknown, unknown, BaseMetadata>
>;

export const evalParametersSerializedSchema = z.record(
  z.string(),
  z.union([
    z.object({
      type: z.literal("prompt"),
      default: promptDataSchema.optional(),
    }),
    z.object({
      type: z.literal("data"),
      schema: z.record(z.unknown()), // JSON Schema
      default: z.unknown().optional(),
    }),
  ]),
);

export type EvalParamaterSerializedSchema = z.infer<
  typeof evalParametersSerializedSchema
>;

export function makeEvalParametersSchema(
  parameters: EvalParameters,
): z.infer<typeof evalParametersSerializedSchema> {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => {
      if ("type" in value && value.type === "prompt") {
        return [
          name,
          {
            type: "prompt",
            default: value.default
              ? promptDefinitionToPromptData(value.default)
              : undefined,
          },
        ];
      } else if (value instanceof z.ZodType) {
        return [
          name,
          {
            type: "data",
            schema: zodToJsonSchema(value),
            default: value.default,
          },
        ];
      } else {
        throw new Error(`Unknown parameter type: ${value}`);
      }
    }),
  );
}

export const evaluatorDefinitionSchema = z.object({
  parameters: evalParametersSerializedSchema.optional(),
});
export type EvaluatorDefinition = z.infer<typeof evaluatorDefinitionSchema>;

export const evaluatorDefinitionsSchema = z.record(
  z.string(),
  evaluatorDefinitionSchema,
);

export type EvaluatorDefinitions = z.infer<typeof evaluatorDefinitionsSchema>;
