import { test, describe, expect, afterAll, beforeAll } from "vitest";
import { configureNode } from "../../node";
import { wrapVitest } from "./index";
import { _exportsForTestingOnly } from "../../logger";

configureNode();

beforeAll(async () => {
  _exportsForTestingOnly.setInitialTestState();
  await _exportsForTestingOnly.simulateLoginForTests();
});

afterAll(async () => {
  await _exportsForTestingOnly.simulateLogoutForTests();
});

const bt = wrapVitest(
  { test, describe, expect, afterAll },
  {
    projectName: "vitest-wrapper-demo",
    displaySummary: true, // Show experiment summary at the end
    onProgress: (event) => {
      if (event.type === "test_complete") {
        console.log(
          `✓ ${event.testName} (${event.duration.toFixed(2)}ms) - ${event.passed ? "PASSED" : "FAILED"}`,
        );
      }
    },
  },
);

bt.describe("Math Operations", () => {
  bt.test("addition works correctly", async () => {
    const result = 2 + 2;

    // Log custom outputs
    bt.logOutputs({ result, operation: "addition" });

    // Log custom feedback/scores
    bt.logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe(4);
  });

  bt.test("multiplication works correctly", async () => {
    const result = 3 * 4;

    bt.logOutputs({ result, operation: "multiplication" });
    bt.logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe(12);
  });

  bt.test("division works correctly", async () => {
    const result = 10 / 2;

    bt.logOutputs({ result, operation: "division" });
    bt.logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe(5);
  });

  // Test with input/expected/metadata
  bt.test(
    "handles complex calculation",
    {
      input: { a: 5, b: 3, operation: "power" },
      expected: 125,
      metadata: { category: "advanced", difficulty: "medium" },
    },
    async ({ input, expected }) => {
      const result = Math.pow(input.a, input.b);

      bt.logOutputs({ result });
      bt.logFeedback({
        name: "accuracy",
        score: result === expected ? 1.0 : 0.0,
      });

      expect(result).toBe(expected);
    },
  );
});

// Example of concurrent tests
bt.describe("Concurrent Operations", () => {
  bt.test.concurrent("async operation 1", async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    bt.logOutputs({ operation: "async-1", duration: 100 });
    expect(true).toBe(true);
  });

  bt.test.concurrent("async operation 2", async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    bt.logOutputs({ operation: "async-2", duration: 50 });
    expect(true).toBe(true);
  });

  bt.test.concurrent("async operation 3", async () => {
    await new Promise((resolve) => setTimeout(resolve, 75));
    bt.logOutputs({ operation: "async-3", duration: 75 });
    expect(true).toBe(true);
  });
});
