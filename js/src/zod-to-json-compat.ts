/**
 * JSON Schema conversion compatibility layer
 *
 * This module provides a unified interface for converting zod schemas to JSON Schema
 * that works with both zod 3.x and 4.x using the zod-to-json-schema library.
 *
 * @module zod-to-json-compat
 */

import type { ZodType } from "zod";
import * as zodModule from "zod";
import { zodToJsonSchema as zodToJsonSchemaLib } from "zod-to-json-schema";

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
/**
 * Converts a zod schema to JSON Schema format.
 * Uses zod 4's built-in zodToJsonSchema if available, otherwise falls back to zod-to-json-schema for zod 3.
 *
 * @param schema - The zod schema to convert
 * @returns JSON Schema representation
 */
export function zodToJsonSchema(schema: ZodType): unknown {
  // Prefer zod 4's instance .toJSONSchema() if available
  if (schema && typeof (schema as any).toJSONSchema === "function") {
    return (schema as any).toJSONSchema();
  }
  // Fallback to zod-to-json-schema for zod 3
  return zodToJsonSchemaLib(schema as any);
}
