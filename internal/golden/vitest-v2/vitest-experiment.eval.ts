import { test, expect, describe, afterAll } from "vitest";
import { wrapVitest, wrapAISDK } from "braintrust";
import { openai } from "@ai-sdk/openai";
import * as ai from "ai";

const { generateText } = wrapAISDK(ai);

// indicate the project name the tests will be sent to
const bt = wrapVitest(
  { test, expect, describe, afterAll },
  { projectName: "golden-ts-vitest-experiment-v2" },
);

bt.describe("Vitest Experiment Mode Tests", () => {
  // Test with input/expected - automatically added to dataset
  bt.test(
    "simple math evaluation",
    {
      input: { query: "What is 2+2?" },
      expected: 4,
      metadata: { category: "math" },
      tags: ["arithmetic"],
    },
    async ({ input, expected }) => {
      const result = 4;
      bt.logOutputs({ answer: result });
      expect(result).toBe(expected);
    },
  );

  // Test with LLM call - added to dataset with input/expected
  bt.test(
    "translation test",
    {
      input: { task: "Translate 'hello' to Spanish" },
      expected: "hola",
      metadata: { category: "translation" },
      tags: ["language", "spanish"],
    },
    async ({ input, expected }) => {
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: (input as any).task,
        maxOutputTokens: 20,
      });

      bt.logOutputs({ translation: result.text });

      const isCorrect = result.text.toLowerCase().includes(expected as string);
      bt.logFeedback({
        name: "correctness",
        score: isCorrect ? 1.0 : 0.0,
      });

      expect(result.text.toLowerCase()).toContain(expected as string);
    },
  );

  // Test without input/expected - runs but not added to dataset
  bt.test("basic functionality test", async () => {
    const result = { value: 42 };
    bt.logOutputs({ result });
    expect(result.value).toBe(42);
  });

  // Test with failure - fail feedback automatically logged
  bt.test(
    "test with failure",
    {
      input: { value: 42 },
      expected: 99,
      metadata: { category: "failure-test" },
    },
    async ({ input, expected }) => {
      const result = (input as any).value;
      bt.logOutputs({ result });
      expect(result).toBe(expected);
    },
  );
});
