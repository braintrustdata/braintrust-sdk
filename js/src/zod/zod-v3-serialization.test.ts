/**
 * Tests for zod v3 compatibility with makeEvalParametersSchema
 *
 * This file tests makeEvalParametersSchema specifically with zod v3.
 * See zod-v4-serialization.test.ts for zod v4 specific tests.
 */

import { test, describe, beforeEach, expect } from "vitest";
import * as zodModule from "zod";
import { z } from "zod";
import { makeEvalParametersSchema } from "../../dev/server";
import {
  EXPECTED_STRING_SCHEMA,
  EXPECTED_NUMBER_SCHEMA,
  EXPECTED_OBJECT_SCHEMA,
  EXPECTED_ENUM_SCHEMA,
  EXPECTED_ARRAY_SCHEMA,
  expectSchemaMatch,
} from "./zod-serialization-test-shared";

// Detect which zod version is installed by checking for v4-specific properties
function getInstalledZodVersion(): 3 | 4 {
  const testSchema = zodModule.z.string();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return "_zod" in (testSchema as any) ? 4 : 3;
}

describe("makeEvalParametersSchema with Zod v3", () => {
  beforeEach(() => {
    const version = getInstalledZodVersion();
    expect(version).toBe(3);
  });

  test("string schema serializes correctly", () => {
    const parameters = {
      instructions: z
        .string()
        .describe("The instructions for the agent")
        .default("You are a helpful assistant."),
    };

    const result = makeEvalParametersSchema(parameters);
    console.log(result);
    expect(result.instructions).toBeDefined();
    expect(result.instructions.type).toBe("data");
    if (result.instructions.type === "data") {
      expectSchemaMatch(result.instructions.schema, EXPECTED_STRING_SCHEMA);
      expect(result.instructions.description).toBe(
        "The instructions for the agent",
      );
      expect(result.instructions.default).toBe("You are a helpful assistant.");
    }
  });

  test("number schema serializes correctly", () => {
    const parameters = {
      temperature: z
        .number()
        .min(0)
        .max(2)
        .describe("Temperature for LLM")
        .default(0.7),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.temperature.type).toBe("data");
    if (result.temperature.type === "data") {
      expectSchemaMatch(result.temperature.schema, EXPECTED_NUMBER_SCHEMA);
      expect(result.temperature.description).toBe("Temperature for LLM");
      expect(result.temperature.default).toBe(0.7);
    }
  });

  test("object schema serializes correctly", () => {
    const parameters = {
      config: z
        .object({
          model: z.string(),
          maxTokens: z.number().optional(),
        })
        .describe("Configuration object"),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.config.type).toBe("data");
    if (result.config.type === "data") {
      expectSchemaMatch(result.config.schema, EXPECTED_OBJECT_SCHEMA);
      expect(result.config.description).toBe("Configuration object");
    }
  });

  test("enum schema serializes correctly", () => {
    const parameters = {
      mode: z
        .enum(["fast", "accurate", "balanced"])
        .describe("Processing mode")
        .default("balanced"),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.mode.type).toBe("data");
    if (result.mode.type === "data") {
      expectSchemaMatch(result.mode.schema, EXPECTED_ENUM_SCHEMA);
      expect(result.mode.description).toBe("Processing mode");
      expect(result.mode.default).toBe("balanced");
    }
  });

  test("array schema serializes correctly", () => {
    const parameters = {
      tags: z
        .array(z.string())
        .describe("Tags for filtering")
        .default(["default"]),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.tags.type).toBe("data");
    if (result.tags.type === "data") {
      expectSchemaMatch(result.tags.schema, EXPECTED_ARRAY_SCHEMA);
      expect(result.tags.description).toBe("Tags for filtering");
      expect(result.tags.default).toEqual(["default"]);
    }
  });
});
