import * as z3 from "zod/v3";
import * as z4 from "zod/v4";
import { zodToJsonSchema as zodToJsonSchemaV3 } from "zod-to-json-schema";

function isZodV4(zodObject: z3.ZodType | z4.ZodType): zodObject is z4.ZodType {
  return "_zod" in zodObject;
}

export function zodToJsonSchema(schema: z3.ZodType | z4.ZodType) {
  if (isZodV4(schema)) {
    return z4.toJSONSchema(schema as z4.ZodType, {
      target: "draft-7",
    });
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return zodToJsonSchemaV3(schema as z3.ZodType);
}

export function getDescription(schema: any): string | undefined {
  // Try .meta()?.description (Zod v4+)
  if (typeof schema.meta === "function") {
    const metaDesc = schema.meta()?.description;
    if (typeof metaDesc === "string" && metaDesc.trim()) return metaDesc;
  }
  // Try .description
  if (typeof schema.description === "string" && schema.description.trim()) {
    return schema.description;
  }
  // Try ._def.description
  if (
    schema._def &&
    typeof schema._def.description === "string" &&
    schema._def.description.trim()
  ) {
    return schema._def.description;
  }
  // Recurse into ._def.innerType
  if (schema._def && schema._def.innerType) {
    return getDescription(schema._def.innerType);
  }
  return undefined;
}

export function getDefaultValue(schema: unknown): unknown {
  let current = schema;
  while (current?._def) {
    const dv = current._def.defaultValue;
    if (typeof dv === "function") {
      return dv();
    }
    if (dv !== undefined) {
      return dv;
    }
    current = current._def.innerType;
  }
  if (typeof schema.default === "function") {
    return schema.default();
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  return undefined;
}
