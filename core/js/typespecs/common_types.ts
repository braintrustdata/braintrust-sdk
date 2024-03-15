import { z } from "zod";

export const literalSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
type Literal = z.infer<typeof literalSchema>;

export type Json = Literal | { [key: string]: Json } | Json[];
export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)])
);

export const datetimeStringSchema = z.string().datetime({ offset: true });

export const objectTypes = [
  "project",
  "experiment",
  "dataset",
  "prompt",
] as const;
export type ObjectType = typeof objectTypes[number];

export function getEventObjectType(objectType: ObjectType) {
  return objectType === "project" ? "project_logs" : objectType;
}
export type EventObjectType = ReturnType<typeof getEventObjectType>;

export function getEventObjectDescription(objectType: ObjectType) {
  return getEventObjectType(objectType).replace("_", " ");
}

export function getEventObjectArticle(objectType: ObjectType) {
  return objectType === "experiment" ? "an" : "a";
}
