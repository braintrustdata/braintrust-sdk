/**
 * Tests for zod v4 compatibility with makeEvalParametersSchema
 *
 * This file tests makeEvalParametersSchema specifically with zod v4.
 * It will only run when zod 4.x is installed.
 */

import { expect, test, describe } from "vitest";
import { z } from "./zod-compat";
import { makeEvalParametersSchema } from "../dev/server";
import * as zodModule from "zod";

// Detect which zod version is installed by checking for v4-specific properties
function getInstalledZodVersion(): 3 | 4 {
  const testSchema = zodModule.z.string();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return "_zod" in (testSchema as any) ? 4 : 3;
}

const zodVersion = getInstalledZodVersion();
const describeOrSkip = zodVersion === 4 ? describe : describe.skip;

describeOrSkip("makeEvalParametersSchema with Zod v4", () => {
  test("string schema serializes correctly", () => {
    const parameters = {
      instructions: z
        .string()
        .describe("The instructions for the agent")
        .default("You are a helpful assistant."),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.instructions).toBeDefined();
    expect(result.instructions.type).toBe("data");
    expect(result.instructions.schema).toHaveProperty("type", "string");
    expect(result.instructions.schema).toHaveProperty(
      "description",
      "The instructions for the agent",
    );
    expect(result.instructions.schema).toHaveProperty(
      "default",
      "You are a helpful assistant.",
    );
    expect(result.instructions.description).toBe(
      "The instructions for the agent",
    );
    expect(result.instructions.default).toBe("You are a helpful assistant.");
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
    expect(result.temperature.schema).toMatchObject({
      type: "number",
      minimum: 0,
      maximum: 2,
      description: "Temperature for LLM",
      default: 0.7,
    });
    expect(result.temperature.description).toBe("Temperature for LLM");
    expect(result.temperature.default).toBe(0.7);
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
    expect(result.config.schema).toMatchObject({
      type: "object",
      properties: {
        model: { type: "string" },
        maxTokens: { type: "number" },
      },
      required: ["model"],
      description: "Configuration object",
    });
    expect(result.config.description).toBe("Configuration object");
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
    expect(result.mode.schema).toMatchObject({
      type: "string",
      enum: ["fast", "accurate", "balanced"],
      description: "Processing mode",
      default: "balanced",
    });
    expect(result.mode.description).toBe("Processing mode");
    expect(result.mode.default).toBe("balanced");
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
    expect(result.tags.schema).toMatchObject({
      type: "array",
      items: { type: "string" },
      description: "Tags for filtering",
      default: ["default"],
    });
    expect(result.tags.description).toBe("Tags for filtering");
    expect(result.tags.default).toEqual(["default"]);
  });
});
