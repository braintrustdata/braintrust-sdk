import {
  FunctionId as functionIdSchema,
  InvokeParent as invokeParentSchema,
  RunEval as runEvalSchema,
  PromptData as promptDataSchema,
} from "../src/generated_types";
import { z } from "zod/v3";
import { EvaluatorDef } from "../src/framework";
import { BaseMetadata } from "../src/logger";

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
  experiment_name: z.string().nullish(),
  project_id: z.string().nullish(),
  parent: invokeParentSchema.optional(),
  stream: z.boolean().optional(),
});

export type EvaluatorManifest = Record<
  string,
  EvaluatorDef<unknown, unknown, unknown, BaseMetadata>
>;

// Legacy format - kept for backwards compatibility
export const evalParametersSerializedHardCodedSchema = z.record(
  z.string(),
  z.union([
    z.object({
      type: z.literal("prompt"),
      default: promptDataSchema.optional(),
      description: z.string().optional(),
    }),
    z.object({
      type: z.literal("data"),
      schema: z.record(z.unknown()),
      default: z.unknown().optional(),
      description: z.string().optional(),
    }),
  ]),
);

// New JSON Schema format
export const evalParametersSerializedSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), z.record(z.unknown())),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

export type EvalParameterSerializedSchema = z.infer<
  typeof evalParametersSerializedSchema
>;

export const parametersSourceSchema = z.object({
  parametersId: z.string().optional(),
  slug: z.string(),
  name: z.string(),
  projectId: z.string().optional(),
  version: z.string().optional(),
});

export type ParametersSource = z.infer<typeof parametersSourceSchema>;

export const evaluatorDefinitionSchema = z.object({
  parameters: z
    .union([
      evalParametersSerializedHardCodedSchema,
      evalParametersSerializedSchema,
    ])
    .optional(),
  parametersSource: parametersSourceSchema.optional(),
  scores: z.array(z.object({ name: z.string() })).optional(),
});
export type EvaluatorDefinition = z.infer<typeof evaluatorDefinitionSchema>;

export const evaluatorDefinitionsSchema = z.record(
  z.string(),
  evaluatorDefinitionSchema,
);

export type EvaluatorDefinitions = z.infer<typeof evaluatorDefinitionsSchema>;
