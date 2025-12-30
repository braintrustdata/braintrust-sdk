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
  return zodToJsonSchemaV3(
    schema as z3.ZodType,
    {
      openaiStrictMode: true,
      nameStrategy: "duplicate-ref",
      $refStrategy: "extract-to-root",
      nullableStrategy: "property",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  );
}

export function zodToJsonSchemaDataObject(schema: z4.ZodType | z3.ZodType) {
  const schemaObj = zodToJsonSchema(schema);

  return {
    type: "data",
    schema: schemaObj,
    default: schemaObj.default,
    description: schemaObj.description,
  };
}
