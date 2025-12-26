// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

// Helper to extract checks/constraints from Zod schema
function extractChecks(def: AnyObj): AnyObj {
  const result: AnyObj = {};

  if (!def.checks || !Array.isArray(def.checks)) {
    return result;
  }

  for (const check of def.checks) {
    // In Zod v4, check has direct properties like format, isInt, etc.
    if (check.format && check.format !== "safeint") {
      result.format = check.format === "datetime" ? "date-time" : check.format;
    }

    // Check for integer flag
    if (check.isInt === true) {
      result.isInteger = true;
    }

    // Check for min/max values on check object
    if (check.minValue !== undefined && check.minValue !== -9007199254740991) {
      result.minimum = check.minValue;
    }
    if (check.maxValue !== undefined && check.maxValue !== 9007199254740991) {
      result.maximum = check.maxValue;
    }

    // Also check the def property for additional constraints
    const checkDef = check._zod?.def || check.def;
    if (checkDef) {
      // Handle pattern (RegExp object needs conversion)
      if (checkDef.pattern) {
        if (checkDef.pattern instanceof RegExp) {
          result.pattern = checkDef.pattern.source;
        } else if (typeof checkDef.pattern === "string") {
          result.pattern = checkDef.pattern;
        }
      }

      // Handle min/max for numbers from checkDef
      if (checkDef.check === "greater_than" && checkDef.value !== undefined) {
        result.minimum = checkDef.value;
      }
      if (checkDef.check === "less_than" && checkDef.value !== undefined) {
        result.maximum = checkDef.value;
      }

      // Handle minLength/maxLength for strings
      if (checkDef.check === "min_length" && checkDef.value !== undefined) {
        result.minLength = checkDef.value;
      }
      if (checkDef.check === "max_length" && checkDef.value !== undefined) {
        result.maxLength = checkDef.value;
      }
    }
  }

  return result;
}

// Helper to add description to result if present
function addDescription(result: AnyObj, schema: AnyObj): AnyObj {
  if (schema.description) {
    result.description = schema.description;
  }
  return result;
}

// Directly generate JSON Schema by walking the Zod schema structure
// This avoids calling .toJSONSchema() which fails on transforms
function schemaToJsonSchema(schema: AnyObj, isRoot = false): AnyObj {
  const def = schema._def;

  // Unwrap pipe types (transforms) - use the input type
  // Also check for openapi.metadata.format for datetime fields
  if (def?.type === "pipe" && def?.in) {
    const result = schemaToJsonSchema(def.in, isRoot);
    // Check for openapi metadata format (used by typespecs)
    if (def?.openapi?.metadata?.format) {
      result.format = def.openapi.metadata.format;
    }
    return addDescription(result, schema);
  }

  // Handle object schemas
  if (def?.type === "object" && def?.shape) {
    const properties: AnyObj = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(def.shape)) {
      properties[key] = schemaToJsonSchema(value, false);

      // Check if field is required (not optional/nullable/nullish)
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const valueDef = (value as AnyObj)._def;
      if (
        valueDef?.type !== "optional" &&
        valueDef?.type !== "nullable" &&
        valueDef?.type !== "nullish"
      ) {
        required.push(key);
      }
    }

    // Check if object has catchall (allows additional properties)
    const additionalProperties =
      def?.catchall && def.catchall._def?.type !== "never"
        ? schemaToJsonSchema(def.catchall, false)
        : false;

    const result: AnyObj = {
      type: "object",
      properties,
      required,
      additionalProperties,
    };

    // Only add $schema to root level
    if (isRoot) {
      result.$schema = "https://json-schema.org/draft/2020-12/schema";
    }

    return addDescription(result, schema);
  }

  // Handle array schemas
  if (def?.type === "array" && def?.element) {
    return addDescription(
      {
        type: "array",
        items: schemaToJsonSchema(def.element, false),
      },
      schema,
    );
  }

  // Handle optional/nullable/nullish wrappers
  if (def?.type === "optional" && def?.innerType) {
    return addDescription(schemaToJsonSchema(def.innerType, isRoot), schema);
  }

  if (def?.type === "nullable" && def?.innerType) {
    const inner = schemaToJsonSchema(def.innerType, false);
    return addDescription(
      {
        anyOf: [inner, { type: "null" }],
      },
      schema,
    );
  }

  if (def?.type === "nullish" && def?.innerType) {
    const inner = schemaToJsonSchema(def.innerType, false);
    return addDescription(
      {
        anyOf: [inner, { type: "null" }],
      },
      schema,
    );
  }

  // Handle union types
  if (def?.type === "union" && def?.options) {
    return addDescription(
      {
        anyOf: def.options.map((opt: AnyObj) => schemaToJsonSchema(opt, false)),
      },
      schema,
    );
  }

  // Handle record types
  if (def?.type === "record" && def?.valueType) {
    return addDescription(
      {
        type: "object",
        additionalProperties: schemaToJsonSchema(def.valueType, false),
      },
      schema,
    );
  }

  // Handle enum types
  if (def?.type === "enum" && def?.values) {
    return addDescription(
      {
        enum: def.values,
      },
      schema,
    );
  }

  // Handle literal types
  if (def?.type === "literal") {
    return addDescription(
      {
        const: def.value,
      },
      schema,
    );
  }

  // Handle intersection types (and)
  if (def?.type === "intersection") {
    // For intersections, merge the schemas using allOf
    return addDescription(
      {
        allOf: [
          schemaToJsonSchema(def.left, false),
          schemaToJsonSchema(def.right, false),
        ],
      },
      schema,
    );
  }

  // Handle transform types - just use the input type
  if (def?.type === "transform") {
    // This shouldn't happen if pipe unwrapping works, but add as fallback
    return {};
  }

  // Handle default (prefault is likely "default" in Zod v4)
  if (def?.type === "prefault" || def?.type === "default") {
    // For defaults, just use the inner type
    if (def?.innerType) {
      return addDescription(schemaToJsonSchema(def.innerType, isRoot), schema);
    }
    return addDescription({}, schema);
  }

  // Handle primitive types
  if (def?.type === "string") {
    const checks = extractChecks(def);
    // Also check for format at the top level of def (Zod v4 string formats)
    if (def.format && !checks.format) {
      checks.format = def.format === "datetime" ? "date-time" : def.format;
    }
    return addDescription({ type: "string", ...checks }, schema);
  }

  if (def?.type === "number") {
    const checks = extractChecks(def);
    const isInteger = checks.isInteger;
    delete checks.isInteger; // Remove the flag, we'll use it for type

    return addDescription(
      { type: isInteger ? "integer" : "number", ...checks },
      schema,
    );
  }

  if (def?.type === "boolean") {
    return addDescription({ type: "boolean" }, schema);
  }

  if (def?.type === "null") {
    return addDescription({ type: "null" }, schema);
  }

  if (def?.type === "undefined") {
    return addDescription({}, schema);
  }

  // Unknown/any types
  if (def?.type === "any" || def?.type === "unknown") {
    return addDescription({}, schema);
  }

  // Fallback for unsupported types - return empty schema (accepts anything)
  return addDescription({}, schema);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function customZodToJsonSchema<T = unknown>(
  schema: AnyObj,
  _options?: unknown,
): unknown {
  return schemaToJsonSchema(schema, true);
}
