import { describe, it } from "vitest";
import { Eval } from "braintrust";

describe("eval via vitest", () => {
  it("should run basic eval directly", async () => {
    await Eval("test-framework-vitest", {
      experimentName: "Basic Test",
      data: () => [{ input: "test", expected: "test" }],
      task: async (input: string) => input,
      scores: [
        ({ output, expected }) => ({
          name: "exact_match",
          score: output === expected ? 1 : 0,
        }),
      ],
    });
  });
});
