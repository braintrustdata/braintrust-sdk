/**
 * Zod v3/v4 compatibility layer
 *
 * This module provides utilities to work with both Zod v3 and v4 schemas.
 */

import type * as z3 from "zod/v3";
import type * as z4 from "zod/v4";
import { zodToJsonSchema as _zodToJsonSchema } from "zod-to-json-schema";

// Type union that accepts either Zod v3 or v4 schemas
export type ZodSchema = z3.ZodType | z4.ZodType;

/**
 * Detects if a schema is from Zod v4
 *
 * Zod v4 schemas have a unique `_zod` property that v3 schemas don't have.
 * This is a reliable runtime check.
 */
export function isZodV4(schema: any): boolean {
  return Boolean(schema && typeof schema === "object" && "_zod" in schema);
}

/**
 * Converts a Zod schema (v3 or v4) to JSON Schema
 *
 * For Zod v4: Uses the native `.toJSONSchema()` method
 * For Zod v3: Falls back to the vendored zod-to-json-schema library
 *
 * @param schema - A Zod v3 or v4 schema
 * @param options - Optional configuration (currently unused for v4, passed to v3 converter)
 * @returns JSON Schema representation
 */
export function zodToJsonSchema(schema: ZodSchema, options?: any): any {
  if (isZodV4(schema)) {
    // Zod v4 has native toJSONSchema support
    try {
      const jsonSchema = (schema as any).toJSONSchema({
        target: "draft-7",
        ...options,
      });

      // Remove $schema if present - some consumers don't expect it
      if (
        jsonSchema &&
        typeof jsonSchema === "object" &&
        "$schema" in jsonSchema
      ) {
        delete jsonSchema.$schema;
      }

      return jsonSchema;
    } catch (error) {
      // If native method fails, fall through to the v3 approach
      console.warn(
        "Zod v4 toJSONSchema failed, falling back to zod-to-json-schema:",
        error,
      );
    }
  }

  // Zod v3 or v4 fallback: use zod-to-json-schema library
  // This is always available as it's imported at the top level
  // Type assertion is safe here as we're treating it as a v3 schema
  return _zodToJsonSchema(schema as any, {
    ...options,
    target: "openApi3",
  });
}

/**
 * Safe wrapper around zodToJsonSchema that returns a placeholder on failure
 *
 * Useful for logging and serialization where you want graceful degradation
 * rather than throwing errors.
 */
export function safeZodToJsonSchema(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return { type: "object", description: "Invalid schema" };
  }

  try {
    return zodToJsonSchema(schema);
  } catch (error) {
    return {
      type: "object",
      description: `Zod schema (conversion failed: ${error instanceof Error ? error.message : String(error)})`,
    };
  }
}
