import { describe, it } from "vitest";
import { Eval } from "braintrust";

// Top-level await works naturally in Vitest
const config = await Promise.resolve({ prefix: "Result: " });

describe("eval with top-level await via vitest", () => {
  it("should run eval with async config", async () => {
    await Eval("test-framework-vitest", {
      experimentName: "Async Test",
      data: () => [{ input: "test", expected: "Result: test" }],
      task: async (input: string) => config.prefix + input,
      scores: [
        ({ output, expected }) => ({
          name: "exact_match",
          score: output === expected ? 1 : 0,
        }),
      ],
    });
  });
});
