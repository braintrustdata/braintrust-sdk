import { describe, test } from "@jest/globals";
import { Eval } from "braintrust";

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

describe("eval via jest", () => {
  test("should run basic eval directly", async () => {
    await Eval("test-framework-jest", {
      experimentName: "Basic Test",
      data: () => [{ input: "test", expected: "test" }],
      task: async (input: string) => input,
      scores: [exactMatch],
    });
  });
});
