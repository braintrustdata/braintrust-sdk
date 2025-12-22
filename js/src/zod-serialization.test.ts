import { expect, test, describe } from "vitest";
import { z as zv3 } from "zod/v3";
import { z as zv4 } from "zod/v4";
import { makeEvalParametersSchema } from "../dev/server";

describe("makeEvalParametersSchema", () => {
  test("Zod v3 string schema serializes correctly", () => {
    const parameters = {
      instructions: zv3
        .string()
        .describe("The instructions for the agent")
        .default("You are a helpful assistant."),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.instructions.schema).toMatchInlineSnapshot(`
      {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "default": "You are a helpful assistant.",
        "description": "The instructions for the agent",
        "type": "string",
      }
    `);
  });

  test("Zod v4 string schema serializes correctly (BRA-3619)", () => {
    // This reproduces the bug reported in BRA-3619:
    // When a user defines parameters with Zod v4, the schema doesn't
    // serialize correctly, causing the playground UI to show JSON/YAML
    // instead of the "Text" input option.
    const parameters = {
      instructions: zv4
        .string()
        .describe("The instructions for the agent")
        .default("You are a helpful assistant."),
    };

    const result = makeEvalParametersSchema(parameters);

    expect(result.instructions.schema).toMatchInlineSnapshot(`
      {
        "$schema": "http://json-schema.org/draft-07/schema#",
      }
    `);
  });
});
