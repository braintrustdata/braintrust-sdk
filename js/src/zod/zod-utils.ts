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
