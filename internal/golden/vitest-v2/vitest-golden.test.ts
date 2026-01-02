import { test, expect, describe, afterAll } from "vitest";
import { wrapVitest, initLogger, wrapAISDK } from "braintrust";
import { openai } from "@ai-sdk/openai";
import * as ai from "ai";

const logger = initLogger({
  projectName: "golden-ts-vitest-v2",
});

const { generateText } = wrapAISDK(ai);
const bt = wrapVitest({ test, expect, describe, afterAll });

bt.describe("Vitest Wrapper Golden Tests", () => {
  bt.afterAll(async () => {
    await logger.flush();
  });

  bt.test("basic test with auto pass/fail", async () => {
    const result = { value: 42 };
    expect(result.value).toBe(42);
    // Pass feedback is automatically logged
  });

  bt.test(
    "test with input and expected",
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
      expect((input as any).query).toBe("What is 2+2?");
      // Pass feedback is automatically logged
    },
  );

  bt.test("test with OpenAI call", async () => {
    const result = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: "Say hello in exactly 3 words",
    });

    // Log output for tracking (pass/fail is automatic)
    bt.logOutputs({ text: result.text });

    // Add custom quality feedback in addition to automatic pass/fail
    bt.logFeedback({ name: "quality", score: 0.9 });

    expect(result.text).toBeTruthy();
    expect(result.text.split(" ").length).toBeLessThanOrEqual(5);
  });

  bt.test(
    "test with OpenAI and eval data",
    {
      input: { task: "Translate 'hello' to Spanish" },
      expected: "hola",
      metadata: { category: "translation" },
    },
    async ({ input, expected }) => {
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: (input as any).task,
      });

      // Log the output for tracking
      bt.logOutputs({ translation: result.text });

      // Add custom correctness metric (in addition to automatic pass/fail)
      const isCorrect = result.text.toLowerCase().includes(expected as string);
      bt.logFeedback({ name: "correctness", score: isCorrect ? 1.0 : 0.0 });

      expect(result.text.toLowerCase()).toContain(expected as string);
      // Pass/fail feedback is automatically logged based on assertion
    },
  );

  bt.test("test with current span", async () => {
    const span = bt.getCurrentSpan();
    expect(span).not.toBeNull();
    expect(span?.log).toBeDefined();
  });

  bt.test("test with failure", async () => {
    const result = { value: 42 };
    bt.logOutputs({ result });
    expect(result.value).toBe(99); // Intentional failure - fail feedback automatically logged
  });
});
