import { writeFileSync } from "node:fs";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as ast from "../btql/ast.js";

const { parsedQuerySchema } = ast;

// Collect every exported Zod schema from ast.ts
const definitions: Record<string, z.ZodTypeAny> = {};
for (const [key, val] of Object.entries(ast)) {
  // Collect Zod schemas
  if (val instanceof z.ZodType) {
    // Skip the root to avoid duplication in $defs
    if (key === "parsedQuerySchema") continue;

    // Cleaner names by dropping trailing "Schema"
    const defName = key.endsWith("Schema") ? key.slice(0, -6) : key;
    definitions[defName] = val;
  }
  // Collect const arrays (like comparisonOps, booleanOps, etc.) and convert to Zod enums
  else if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") {
    // Convert const arrays to Zod enums for proper type generation
    const defName = key.endsWith("s") ? key.slice(0, -1) : key;
    definitions[defName] = z.enum(val as [string, ...string[]]);
  }
}

const jsonSchema = zodToJsonSchema(parsedQuerySchema, {
  target: "jsonSchema7",
  $refStrategy: "root",
  definitions,
});

const outputPath = new URL("../btql_schema.json", import.meta.url);
writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2));

console.log(`Exported query schema to btql_schema.json`);
