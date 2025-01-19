import { invokeParent } from "@braintrust/core/typespecs";
import { z } from "zod";
import { EvaluatorDef } from "../framework";
import { BaseMetadata } from "../logger";

export const evalBodySchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  parent: invokeParent.optional(),
});

export type EvaluatorManifest = Record<string, EvaluatorSpec>;

interface EvaluatorSpec {
  parameters: Record<string, ParameterSpec>;
  evaluator: EvaluatorDef<unknown, unknown, unknown, BaseMetadata>;
}

const parameterTypeSchema = z.union([
  z.literal("string"),
  z.literal("number"),
  z.literal("boolean"),
  z.literal("prompt"),
  z.literal("unknown"),
]);
export type ParameterType = z.infer<typeof parameterTypeSchema>;

const parameterSpecSchema = z.object({
  type: parameterTypeSchema,
  default: z.unknown(),
});

export type ParameterSpec = z.infer<typeof parameterSpecSchema>;

export const evaluatorListSchema = z.record(
  z.string(),
  z.object({ parameters: z.record(z.string(), parameterSpecSchema) }),
);

export type EvaluatorList = z.infer<typeof evaluatorListSchema>;
