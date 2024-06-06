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
  z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)]),
);

export const datetimeStringSchema = z.string().datetime({ offset: true });

export const objectTypes = z.enum([
  "project",
  "experiment",
  "dataset",
  "prompt",
  "prompt_session",
  "role",
  "group",
  "acl",
  "user",
  "project_score",
  "project_tag",
  "function",
]);
export type ObjectType = z.infer<typeof objectTypes>;

export const objectTypesWithEvent = z.enum([
  "project",
  "experiment",
  "dataset",
  "prompt",
  "function",
  "prompt_session",
]);
export type ObjectTypeWithEvent = z.infer<typeof objectTypesWithEvent>;

export function getEventObjectType(objectType: ObjectTypeWithEvent) {
  return objectType === "project" ? "project_logs" : objectType;
}
export type EventObjectType = ReturnType<typeof getEventObjectType>;

export function getEventObjectDescription(objectType: ObjectTypeWithEvent) {
  return getEventObjectType(objectType).replace("_", " ");
}

export function getObjectArticle(objectType: ObjectType) {
  return ["acl", "experiment"].includes(objectType) ? "an" : "a";
}
