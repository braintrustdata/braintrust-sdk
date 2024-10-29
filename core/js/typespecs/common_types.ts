import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
extendZodWithOpenApi(z);

export const literalSchema = z.union([
  z.string().openapi({ title: "string" }),
  z.number().openapi({ title: "number" }),
  z.boolean().openapi({ title: "boolean" }),
  z.null().openapi({ title: "null" }),
]);
type Literal = z.infer<typeof literalSchema>;

export type Json = Literal | { [key: string]: Json } | Json[];
export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    literalSchema,
    z.array(jsonSchema).openapi({ title: "array" }),
    z.record(jsonSchema).openapi({ title: "object" }),
  ]),
);

function msUnixTimestampToISO(ms: number) {
  // https://stackoverflow.com/questions/59394911/get-isostring-in-microseconds-from-unix-timestamp
  return new Date(ms)
    .toISOString()
    .replace(/\d+Z$/, String(Math.round(ms * 1000)).slice(-6) + "Z");
}

// It is often hard for us to control every piece of code that serializes
// datetimes to strings to ensure they are always strictly ISO8601-compliant.
// Thus asserting `z.string().datetime()` will not often work. While
// `z.string().datetime({ offset: true })` could work, it has the downside of
// not actually sanitizing the string to a consistent format, which is a
// nice-to-have.
//
// Thus we implement this more-lenient parsing and sanitization as a transform
// and explicitly add the "date-time" format specifier for openAPI.
export const datetimeStringSchema = z
  .string()
  .transform((x, ctx) => {
    const d = new Date(x);
    if (isNaN(d.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.invalid_string,
        validation: "datetime",
        message: "Invalid datetime",
      });
      return z.NEVER;
    }

    const iso = d.toISOString();

    // Check if original string had microsecond precision (6 decimal digits).
    // If so, preserve them.
    const match = x.match(/\.\d{6}(?=[Z+-])/);
    if (match) {
      return iso.replace(/\.\d+Z/, match[0] + "Z");
    }
    return iso;
  })
  .openapi({ format: "date-time" });

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
  "span_iframe",
  "function",
  "view",
  "organization",
  "api_key",
  "ai_secret",
  "env_var",
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

export const eventObjectType = objectTypesWithEvent
  .exclude(["project"])
  .or(z.enum(["project_logs"]));
export type EventObjectType = z.infer<typeof eventObjectType>;

export function getEventObjectType(
  objectType: ObjectTypeWithEvent,
): EventObjectType {
  return objectType === "project" ? "project_logs" : objectType;
}

export function getEventObjectDescription(objectType: ObjectTypeWithEvent) {
  return getEventObjectType(objectType).replace("_", " ");
}

export function getObjectArticle(objectType: ObjectType) {
  return [
    "acl",
    "api_key",
    "experiment",
    "organization",
    "ai_secret",
    "env_var",
  ].includes(objectType)
    ? "an"
    : "a";
}
