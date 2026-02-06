import {
  FunctionId as functionIdSchema,
  InvokeParent as invokeParentSchema,
  RunEval as runEvalSchema,
  PromptData as promptDataSchema,
  StaticParameters as _staticParametersSchema,
  EvalParametersJsonSchema as _parametersSchema,
  ParametersSource as _parametersSourceSchema,
  ParametersContainer as _parametersContainerSchema,
  StaticParametersContainer as _staticParametersContainerSchema,
  SerializedParametersContainer as _serializedParametersContainerSchema,
  EvaluatorDefinition as _evaluatorDefinitionSchema,
  EvaluatorDefinitions as _evaluatorDefinitionsSchema,
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

export const staticParametersSchema = _staticParametersSchema;
export type StaticParametersSchema = z.infer<typeof staticParametersSchema>;

const evalParametersSerializedSchema = staticParametersSchema;
export type EvalParameterSerializedSchema = z.infer<
  typeof evalParametersSerializedSchema
>;

export const parametersSchema = _parametersSchema;
export type ParametersSchema = z.infer<typeof parametersSchema>;

export const parametersSourceSchema = _parametersSourceSchema;
export type ParametersSource = z.infer<typeof parametersSourceSchema>;

export const parametersContainerSchema = _parametersContainerSchema;
export type ParametersContainer = z.infer<typeof parametersContainerSchema>;

export const staticParametersContainerSchema = _staticParametersContainerSchema;
export type StaticParametersContainer = z.infer<
  typeof staticParametersContainerSchema
>;

export const serializedParametersContainerSchema =
  _serializedParametersContainerSchema;
export type SerializedParametersContainer = z.infer<
  typeof serializedParametersContainerSchema
>;

export const evaluatorDefinitionSchema = _evaluatorDefinitionSchema;
export type EvaluatorDefinition = z.infer<typeof evaluatorDefinitionSchema>;

export const evaluatorDefinitionsSchema = _evaluatorDefinitionsSchema;
export type EvaluatorDefinitions = z.infer<typeof evaluatorDefinitionsSchema>;
