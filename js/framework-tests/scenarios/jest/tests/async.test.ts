import { describe, test } from "@jest/globals";
import { Eval } from "braintrust";

// Top-level await
const config = await Promise.resolve({ prefix: "Result: " });

const exactMatch = ({
  output,
  expected,
}: {
  output: string;
  expected?: string;
}) => ({
  name: "exact_match",
  score: output === expected ? 1 : 0,
});

describe("eval with top-level await via jest", () => {
  test("should run eval with async config", async () => {
    await Eval("test-framework-jest", {
      experimentName: "Async Test",
      data: () => [{ input: "test", expected: "Result: test" }],
      task: async (input: string) => config.prefix + input,
      scores: [exactMatch],
    });
  });
});
