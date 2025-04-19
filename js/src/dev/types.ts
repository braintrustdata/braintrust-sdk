import { invokeParent } from "@braintrust/core/typespecs";
import { z } from "zod";
import { EvaluatorDef } from "../framework";
import { BaseMetadata } from "../logger";
import { EvalParameters } from "../eval-parameters";
import zodToJsonSchema from "zod-to-json-schema";

export const evalBodySchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.unknown()).nullish(),
  parent: invokeParent.optional(),
});

export type EvaluatorManifest = Record<
  string,
  EvaluatorDef<unknown, unknown, unknown, BaseMetadata>
>;

export const evalParametersSerializedSchema = z.record(
  z.string(),
  z.union([
    z.literal("prompt"),
    z.record(z.unknown()), // JSON Schema
  ]),
);

export function makeEvalParametersSchema(
  parameters: EvalParameters,
): z.infer<typeof evalParametersSerializedSchema> {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => {
      if (value === "prompt") {
        return [name, "prompt"];
      }
      return [name, zodToJsonSchema(value)];
    }),
  );
}

export const evaluatorDefinitionsSchema = z.record(
  z.string(),
  z.object({ parameters: evalParametersSerializedSchema.optional() }),
);

export type EvaluatorDefinitions = z.infer<typeof evaluatorDefinitionsSchema>;
