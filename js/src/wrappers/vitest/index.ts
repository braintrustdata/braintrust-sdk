import { currentSpan } from "../../logger";
import {
  wrapTest,
  wrapDescribe,
  getExperimentContext,
  formatExperimentSummary,
} from "./wrapper";
import type { VitestMethods, BraintrustVitest, WrapperConfig } from "./types";
import { loadDataset } from "./dataset-helpers";

export type { TestConfig, TestContext, Score, ScorerFunction } from "./types";
export { loadDataset } from "./dataset-helpers";
export type { DatasetOptions, DatasetRecord } from "./dataset-helpers";

/**
 * Wraps Vitest methods with Braintrust experiment tracking. This automatically creates
 * datasets and experiments from your Vitest tests, tracking pass/fail rates and evaluation metrics.
 * Experiments are automatically flushed after all tests complete.
 *
 * @param vitestMethods - Object containing Vitest methods (test, describe, expect, etc.)
 * @param config - Optional configuration object
 * @param config.projectName - Project name for the experiment (defaults to suite name)
 * @param config.displaySummary - If true, displays experiment summary after flushing (defaults to true)
 * @returns Wrapped Vitest methods with Braintrust experiment tracking
 *
 * @example Basic Usage
 * ```typescript
 * import { test, expect, describe, afterAll } from 'vitest';
 * import { wrapVitest } from 'braintrust';
 *
 * const bt = wrapVitest(
 *   { test, expect, describe, afterAll },
 *   { projectName: 'my-project' }
 * );
 *
 * bt.describe('Translation Tests', () => {
 *   bt.afterAll(async () => {
 *     await bt.flushExperiment(); // Flushes and displays experiment summary
 *   });
 *
 *   // Tests with input/expected are automatically added to the dataset
 *   bt.test(
 *     'translates hello',
 *     {
 *       input: { text: 'hello' },
 *       expected: 'hola',
 *       metadata: { language: 'spanish' },
 *     },
 *     async ({ input, expected }) => {
 *       const result = await translate(input.text);
 *       bt.logOutputs({ translation: result });
 *       expect(result).toBe(expected);
 *     }
 *   );
 *
 *   // Tests without input/expected still run and track pass/fail
 *   bt.test('basic functionality', async () => {
 *     const result = await someFunction();
 *     expect(result).toBeTruthy();
 *   });
 * });
 * ```
 *
 * @see README.md for full documentation and examples
 */
export function wrapVitest<VitestContext = unknown, ExpectType = unknown>(
  vitestMethods: VitestMethods<VitestContext, ExpectType>,
  config: WrapperConfig = {},
): BraintrustVitest<VitestContext, ExpectType> {
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

  const wrappedTest = wrapTest<VitestContext>(vitestMethods.test, config);
  const wrappedDescribe = wrapDescribe(
    vitestMethods.describe,
    config,
    vitestMethods.afterAll,
  );

  return {
    test: wrappedTest,
    it: wrappedTest,
    expect: vitestMethods.expect,
    describe: wrappedDescribe,
    beforeAll: vitestMethods.beforeAll || (() => {}),
    afterAll: vitestMethods.afterAll || (() => {}),
    beforeEach: vitestMethods.beforeEach,
    afterEach: vitestMethods.afterEach,
    loadDataset,
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
    flushExperiment: async (options?: { displaySummary?: boolean }) => {
      const ctx = getExperimentContext();
      if (!ctx) {
        console.warn(
          "Braintrust: No experiment context found. Make sure you're using bt.describe() and calling flushExperiment() within an afterAll() hook.",
        );
        return;
      }

      // Default displaySummary to the config value, or true if not specified
      const shouldDisplaySummary =
        options?.displaySummary ?? config.displaySummary ?? true;

      // Get summary before flushing
      let summary;
      if (shouldDisplaySummary) {
        try {
          summary = await ctx.experiment.summarize();
        } catch (error) {
          console.warn(
            "Braintrust: Failed to generate experiment summary:",
            error,
          );
        }
      }

      // Flush the experiment
      await ctx.experiment.flush();

      // Display summary after flushing
      if (summary && shouldDisplaySummary) {
        console.log(formatExperimentSummary(summary));
      }
    },
  };
}
