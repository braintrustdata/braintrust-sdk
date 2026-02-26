import * as vitest from "vitest";
import { wrapVitest, wrapAISDK } from "braintrust";
import { openai } from "@ai-sdk/openai";
import * as ai from "ai";

const { generateText } = wrapAISDK(ai);

// A reusable scorer defined as a named function — can be shared across tests
function containsExpected({
  output,
  expected,
}: {
  output: unknown;
  expected?: unknown;
}) {
  return {
    name: "contains_expected",
    score:
      typeof output === "string" &&
      typeof expected === "string" &&
      output.includes(expected)
        ? 1.0
        : 0.0,
  };
}

// Automatically creates datasets and experiments
const { describe, test, expect } = wrapVitest(vitest, {
  projectName: "golden-ts-vitest-experiment-v4",
});

describe("Vitest Experiment Mode Tests", () => {
  // Test with input/expected - automatically added to dataset
  test(
    "simple math evaluation",
    {
      input: { query: "What is 2+2?" },
      expected: 4,
      metadata: { category: "math" },
      tags: ["arithmetic"],
    },
    async ({ input, expected }) => {
      const result = 4;
      expect(result, "answer").toBe(expected);
    },
  );

  // Test with a scorer - automatically evaluates output against expected after the test runs
  test(
    "math with scorer",
    {
      input: { a: 10, b: 3 },
      expected: 7,
      metadata: { category: "math" },
      scorers: [
        ({ output, expected }) => ({
          name: "exact_match",
          score: output === expected ? 1.0 : 0.0,
        }),
      ],
    },
    async ({ input, expected }) => {
      const result = (input as any).a - (input as any).b;
      expect(result, "result").toBe(expected);
      return result;
    },
  );

  // Test with LLM call - uses a named scorer loaded from outside the test
  test(
    "translation test",
    {
      input: { task: "Translate 'hello' to Spanish" },
      expected: "hola",
      metadata: { category: "translation" },
      tags: ["language", "spanish"],
      scorers: [containsExpected],
    },
    async ({ input, expected }) => {
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: (input as any).task,
        maxOutputTokens: 20,
      });

      expect(result.text.toLowerCase(), "translation").toContain(
        expected as string,
      );
      return result.text.toLowerCase();
    },
  );

  // Test without input/expected - runs but not added to dataset
  test("basic functionality test", async () => {
    const result = { value: 42 };
    expect(result.value, "value").toBe(42);
  });

  // Test with failure - fail feedback automatically logged
  test(
    "test with failure",
    {
      input: { value: 42 },
      expected: 99,
      metadata: { category: "failure-test" },
    },
    async ({ input, expected }) => {
      const result = (input as any).value;
      expect(result, "result").toBe(expected);
    },
  );
});
