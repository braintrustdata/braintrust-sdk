/**
 * Shared test expectations for zod serialization tests
 *
 * This module contains expected JSON Schema outputs used by both v3 and v4
 * serialization tests to ensure consistent behavior across versions.
 */

/**
 * Expected JSON schema for string parameter with description and default
 */

export const EXPECTED_STRING_SCHEMA = {
  type: "string",
  description: "The instructions for the agent",
  default: "You are a helpful assistant.",
  $schema: "http://json-schema.org/draft-07/schema#",
};

/**
 * Expected JSON schema for number parameter with constraints
 */

export const EXPECTED_NUMBER_SCHEMA = {
  type: "number",
  minimum: 0,
  maximum: 2,
  description: "Temperature for LLM",
  default: 0.7,
  $schema: "http://json-schema.org/draft-07/schema#",
};

/**
 * Expected JSON schema for object parameter
 */

export const EXPECTED_OBJECT_SCHEMA = {
  type: "object",
  properties: {
    model: { type: "string" },
    maxTokens: { type: "number" },
  },
  additionalProperties: false,
  required: ["model"],
  description: "Configuration object",
  $schema: "http://json-schema.org/draft-07/schema#",
};

/**
 * Expected JSON schema for enum parameter
 */

export const EXPECTED_ENUM_SCHEMA = {
  type: "string",
  enum: ["fast", "accurate", "balanced"],
  description: "Processing mode",
  default: "balanced",
  $schema: "http://json-schema.org/draft-07/schema#",
};

/**
 * Expected JSON schema for array parameter
 */

export const EXPECTED_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string" },
  description: "Tags for filtering",
  default: ["default"],
  $schema: "http://json-schema.org/draft-07/schema#",
};
