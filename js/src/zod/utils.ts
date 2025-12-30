import { zodToJsonSchema as zodToJsonSchemaV3 } from "zod-to-json-schema";
import * as z3 from "zod/v3";
import * as z4 from "zod/v4";

function isZodV4(zodObject: z3.ZodType | z4.ZodType): zodObject is z4.ZodType {
  return (
    typeof zodObject === "object" &&
    zodObject !== null &&
    "_zod" in zodObject &&
    (zodObject as any)._zod !== undefined
  );
}

export function zodToJsonSchema(schema: z4.ZodType | z3.ZodType) {
  if (isZodV4(schema)) {
    return z4.toJSONSchema(schema as z4.ZodType, {
      target: "draft-7",
    });
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return zodToJsonSchemaV3(schema as z3.ZodType);
}

export function zodToJsonSchemaObject(schema: z4.ZodType | z3.ZodType) {
  if (isZodV4(schema)) {
    return z4.toJSONSchema(schema as z4.ZodType, {
      target: "draft-7",
    });
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return zodToJsonSchemaV3(schema as z3.ZodType);
}

export function getDescription(schema: unknown): string | undefined {
  if (typeof schema === "object" && schema !== null) {
    // meta()?.description (Zod v4+)
    if ("meta" in schema && typeof (schema as any).meta === "function") {
      const metaDesc = (schema as any).meta()?.description;
      if (typeof metaDesc === "string" && metaDesc.trim()) return metaDesc;
    }
    // .description
    if (
      "description" in schema &&
      typeof (schema as any).description === "string" &&
      (schema as any).description.trim()
    ) {
      return (schema as any).description;
    }
    // ._def.description
    if (
      "_def" in schema &&
      (schema as any)._def &&
      typeof (schema as any)._def.description === "string" &&
      (schema as any)._def.description.trim()
    ) {
      return (schema as any)._def.description;
    }
    // recurse ._def.innerType
    if (
      "_def" in schema &&
      (schema as any)._def &&
      (schema as any)._def.innerType
    ) {
      return getDescription((schema as any)._def.innerType);
    }
  }
  return undefined;
}

export function getDefaultValue(schema: unknown): unknown {
  let current = schema;
  while (typeof current === "object" && current !== null && "_def" in current) {
    const def = (current as any)._def;
    if (def) {
      const dv = def.defaultValue;
      if (typeof dv === "function") {
        return dv();
      }
      if (dv !== undefined) {
        return dv;
      }
      if (def.innerType) {
        current = def.innerType;
        continue;
      }
    }
    break;
  }
  if (typeof schema === "object" && schema !== null) {
    if ("default" in schema && typeof (schema as any).default === "function") {
      return (schema as any).default();
    }
    if ("default" in schema && (schema as any).default !== undefined) {
      return (schema as any).default;
    }
  }
  return undefined;
}
