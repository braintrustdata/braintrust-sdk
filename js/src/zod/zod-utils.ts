import { zodToJsonSchema as zodToJsonSchemaV3 } from "zod-to-json-schema";
import { z } from "zod";

export function zodToJsonSchema(schema: any) {
  if (schema && typeof (schema as any).toJSONSchema === "function") {
    return (schema as any).toJSONSchema(schema as any, {
      target: "draft-7",
    });
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return zodToJsonSchemaV3(schema as any);
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

// Utility to get a ZodUnknown schema
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getZodUnknown(): any {
  return z.unknown() as any;
}

// Utility to get a ZodRecord schema compatible with both Zod v3 and v4
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getZodRecord(valueSchema: any): any {
  // Zod v4 requires key type as first argument, v3 makes it optional
  // Try v3 style first (single argument)
  try {
    return z.record(valueSchema as any) as any;
  } catch {
    // Fall back to v4 style (key type + value type)
    return z.record(z.string(), valueSchema as any) as any;
  }
}
