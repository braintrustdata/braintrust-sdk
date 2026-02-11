/**
 * AI SDK v6-specific tests
 * These tests verify v6-specific API behavior that differs from v5
 */
import { test, describe, expect } from "vitest";
import * as ai from "ai";
import { z } from "zod";

describe("ai sdk v6 API shape", () => {
  test("v6: Output.object responseFormat is a Promise", async () => {
    const schema = z.object({
      name: z.string().describe("A name"),
    });

    const outputSchema = ai.Output.object({ schema });

    // v6-specific: responseFormat is a Promise
    expect(outputSchema.responseFormat).toBeInstanceOf(Promise);

    const resolved = await outputSchema.responseFormat;
    expect(resolved.type).toBe("json");
    expect(resolved.schema).toBeDefined();
  });
});
