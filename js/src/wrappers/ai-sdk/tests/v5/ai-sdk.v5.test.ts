/**
 * AI SDK v5-specific tests
 * These tests verify v5-specific API behavior that differs from v6
 */
import { test, describe, expect } from "vitest";
import * as ai from "ai";
import { z } from "zod";

describe("ai sdk v5 API shape", () => {
  test("v5: Output.object responseFormat is a plain object", () => {
    const schema = z.object({
      name: z.string().describe("A name"),
    });

    const outputSchema = ai.Output.object({ schema });

    // v5-specific: responseFormat is a plain object with the schema already resolved
    expect(outputSchema.responseFormat).not.toBeInstanceOf(Promise);
    expect(typeof outputSchema.responseFormat).toBe("object");
    expect(outputSchema.responseFormat.type).toBe("json");
    expect(outputSchema.responseFormat.schema).toBeDefined();
  });
});
