import { currentSpan } from "../../logger";
import { wrapTest, wrapDescribe } from "./wrapper";
import type { VitestMethods, BraintrustVitest, WrapperConfig } from "./types";

export type { TestConfig, TestContext } from "./types";

/**
 * Wraps Vitest methods with Braintrust tracing. This automatically sends test trace execution.
 *
 * @param vitestMethods - Object containing Vitest methods (test, describe, expect, etc.)
 * @param config - Optional configuration
 * @returns Wrapped Vitest methods with Braintrust tracing
 *
 * @example
 * ```typescript
 * import { test, expect, describe } from 'vitest';
 * import { wrapVitest } from 'braintrust/vitest';
 *
 * const bt = wrapVitest({ test, expect, describe });
 *
 * bt.describe('My Tests', () => {
 *   bt.test('should work', async () => {
 *     const result = await myFunction();
 *     bt.logOutputs({ result });
 *     expect(result).toBe('expected');
 *   });
 * });
 * ```
 */
export function wrapVitest(
  vitestMethods: VitestMethods,
  config: WrapperConfig = {},
): BraintrustVitest {
  if (!vitestMethods.test) {
    throw new Error(
      "Braintrust: vitestMethods.test is required. Please pass in the test function from vitest.",
    );
  }
  if (!vitestMethods.describe) {
    throw new Error(
      "Braintrust: vitestMethods.describe is required. Please pass in the describe function from vitest.",
    );
  }
  if (!vitestMethods.expect) {
    throw new Error(
      "Braintrust: vitestMethods.expect is required. Please pass in the expect function from vitest.",
    );
  }

  const wrappedTest = wrapTest(vitestMethods.test, config);
  const wrappedDescribe = wrapDescribe(vitestMethods.describe, config);

  return {
    test: wrappedTest,
    it: wrappedTest,
    expect: vitestMethods.expect,
    describe: wrappedDescribe,
    beforeAll: vitestMethods.beforeAll || (() => {}),
    afterAll: vitestMethods.afterAll || (() => {}),
    beforeEach: vitestMethods.beforeEach,
    afterEach: vitestMethods.afterEach,
    logOutputs: (outputs: Record<string, unknown>) => {
      const span = currentSpan();
      if (!span) {
        console.warn(
          "Braintrust: No active span. logOutputs() must be called within a wrapped test.",
        );
        return;
      }
      span.log({ output: outputs });
    },
    logFeedback: (feedback: {
      name: string;
      score: number;
      metadata?: Record<string, unknown>;
    }) => {
      const span = currentSpan();
      if (!span) {
        console.warn(
          "Braintrust: No active span. logFeedback() must be called within a wrapped test.",
        );
        return;
      }
      span.log({
        scores: {
          [feedback.name]: feedback.score,
        },
        metadata: feedback.metadata,
      });
    },
    getCurrentSpan: () => {
      return currentSpan();
    },
  };
}
