/**
 * Tests for zod v3 compatibility with makeEvalParametersSchema
 *
 * This file tests makeEvalParametersSchema specifically with zod v3.
 * See zod-v4-serialization.test.ts for zod v4 specific tests.
 */

import { test, describe, beforeEach, expect } from "vitest";
import * as zodModule from "zod";
import { z } from "zod";
import { makeEvalParametersSchema } from "../framework2";
import {
  EXPECTED_STRING_SCHEMA,
  EXPECTED_NUMBER_SCHEMA,
  EXPECTED_OBJECT_SCHEMA,
  EXPECTED_ENUM_SCHEMA,
  EXPECTED_ARRAY_SCHEMA,
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

    expect(result.type).toBe("object");
    expect(result.properties.instructions).toStrictEqual(
      EXPECTED_STRING_SCHEMA,
    );
    expect(result.required).toBeUndefined();
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

    expect(result.type).toBe("object");
    expect(result.properties.temperature).toStrictEqual(EXPECTED_NUMBER_SCHEMA);
    expect(result.required).toBeUndefined();
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

    expect(result.type).toBe("object");
    expect(result.properties.config).toStrictEqual(EXPECTED_OBJECT_SCHEMA);
    expect(result.required).toContain("config");
  });

  test("enum schema serializes correctly", () => {
    const parameters = {
      mode: z
        .enum(["fast", "accurate", "balanced"])
        .describe("Processing mode")
        .default("balanced"),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.type).toBe("object");
    expect(result.properties.mode).toStrictEqual(EXPECTED_ENUM_SCHEMA);
    expect(result.required).toBeUndefined();
  });

  test("array schema serializes correctly", () => {
    const parameters = {
      tags: z
        .array(z.string())
        .describe("Tags for filtering")
        .default(["default"]),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.type).toBe("object");
    expect(result.properties.tags).toStrictEqual(EXPECTED_ARRAY_SCHEMA);
    expect(result.required).toBeUndefined();
  });

  test("required fields are tracked correctly", () => {
    const parameters = {
      requiredField: z.string(),
      optionalField: z.string().default("default value"),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.type).toBe("object");
    expect(result.required).toContain("requiredField");
    expect(result.required).not.toContain("optionalField");
  });
});
