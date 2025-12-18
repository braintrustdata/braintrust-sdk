/**
 * JSON Schema conversion compatibility layer
 *
 * This module provides a unified interface for converting zod schemas to JSON Schema
 * that works with both zod 3.x and 4.x using the zod-to-json-schema library.
 *
 * @module zod-to-json-compat
 */

import type { ZodType } from "./zod-compat";

let zodToJsonSchemaV3: ((schema: ZodType) => unknown) | null = null;

/**
 * Converts a zod schema to JSON Schema format.
 * Uses the zod-to-json-schema library which supports both zod 3.x and 4.x.
 *
 * Note: We always use zod-to-json-schema rather than zod v4's native toJSONSchema
 * because the SDK uses zod/v3 exports for compatibility, and those schemas don't
 * work with v4's native toJSONSchema function.
 *
 * @param schema - The zod schema to convert
 * @returns JSON Schema representation
 */
export function zodToJsonSchema(schema: ZodType): unknown {
  // Lazy load converter on first use
  if (!zodToJsonSchemaV3) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const zodToJsonSchemaLib = require("zod-to-json-schema");
    zodToJsonSchemaV3 = zodToJsonSchemaLib.zodToJsonSchema;
  }

  if (!zodToJsonSchemaV3) {
    throw new Error("zod-to-json-schema library is not loaded");
  }
  return zodToJsonSchemaV3(schema);
}
