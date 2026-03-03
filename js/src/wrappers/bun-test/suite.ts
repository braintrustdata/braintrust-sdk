import { initExperiment, type Experiment } from "../../logger";
import { runTracedEval } from "../shared/traced-eval";
import { summarizeAndFlush } from "../shared/flush";
import type {
  BunTestSuite,
  EvalConfig,
  EvalContext,
  SuiteTestFunction,
} from "./types";
import type { BunTestSuiteConfig } from "./types";

type TestFn = (...args: any[]) => any;

/** The shape we expect from bun:test's `test` at runtime. */
interface ValidatedTestFunction extends TestFn {
  skip: TestFn;
  only: TestFn;
  todo: TestFn;
  failing: TestFn;
  concurrent: TestFn;
  serial: TestFn;
  if: (condition: boolean) => TestFn;
  skipIf: (condition: boolean) => TestFn;
  todoIf: (condition: boolean) => TestFn;
}

const DIRECT_MODIFIERS = [
  "skip",
  "only",
  "todo",
  "failing",
  "concurrent",
  "serial",
] as const;
const CONDITIONAL_MODIFIERS = ["if", "skipIf", "todoIf"] as const;

function validateTestFunction(test: unknown): ValidatedTestFunction {
  if (typeof test !== "function") {
    throw new Error(
      `initBunTestSuite: "test" must be a function (got ${typeof test}). ` +
        `Pass the "test" export from bun:test.`,
    );
  }
  const t = test as unknown as Record<string, unknown>;
  for (const mod of [...DIRECT_MODIFIERS, ...CONDITIONAL_MODIFIERS]) {
    if (typeof t[mod] !== "function") {
      throw new Error(
        `initBunTestSuite: "test.${mod}" must be a function (got ${typeof t[mod]}). ` +
          `Make sure you are passing the "test" export from bun:test.`,
      );
    }
  }
  return test as ValidatedTestFunction;
}

/**
 * Creates a new Bun test suite with Braintrust experiment tracking.
 *
 * @example
 * ```typescript
 * import { test, describe, afterAll } from 'bun:test';
 * import { initBunTestSuite } from 'braintrust';
 *
 * describe('My Tests', () => {
 *   const suite = initBunTestSuite({
 *     projectName: 'my-project',
 *     afterAll,
 *     test,
 *   });
 *
 *   suite.test('my eval', {
 *     input: 'hello',
 *     expected: 'world',
 *     scorers: [myScorer],
 *   }, async ({ input }) => {
 *     return await myFunction(input);
 *   });
 * });
 * ```
 */
export function initBunTestSuite<TTest extends (...args: any[]) => any>(
  config: BunTestSuiteConfig<TTest>,
): BunTestSuite {
  let experiment: Experiment | undefined;

  const getOrCreateExperiment = (): Experiment => {
    if (experiment) {
      return experiment;
    }

    const experimentName =
      config.experimentName ||
      `${config.projectName}-${new Date().toISOString()}`;
    const initExp = config._initExperiment ?? initExperiment;
    experiment = initExp(config.projectName, {
      experiment: experimentName,
    }) as Experiment;
    return experiment;
  };

  function createTracedFn(
    name: string,
    evalConfig: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ): () => Promise<void> {
    return async () => {
      const exp = getOrCreateExperiment();
      const spanName = evalConfig.name ?? name;

      if (config.onProgress) {
        config.onProgress({ type: "test_start", testName: spanName });
      }

      const startTime = performance.now();
      let passed = false;

      try {
        await runTracedEval({
          experiment: exp,
          spanName,
          input: evalConfig.input,
          expected: evalConfig.expected,
          metadata: evalConfig.metadata,
          tags: evalConfig.tags,
          scorers: evalConfig.scorers,
          fn: () =>
            fn({
              input: evalConfig.input,
              expected: evalConfig.expected,
              metadata: evalConfig.metadata,
            }),
        });
        passed = true;
      } catch (error) {
        passed = false;
        throw error;
      } finally {
        if (config.onProgress) {
          config.onProgress({
            type: "test_complete",
            testName: spanName,
            passed,
            duration: performance.now() - startTime,
          });
        }
      }
    };
  }

  function wrapTestVariant(
    testFn: (name: string, fn: () => void | Promise<void>) => void,
  ) {
    return (
      name: string,
      evalConfig: EvalConfig,
      fn: (context: EvalContext) => unknown | Promise<unknown>,
    ) => {
      testFn(name, createTracedFn(name, evalConfig, fn));
    };
  }

  function wrapConditional(
    modifier: (
      condition: boolean,
    ) => (name: string, fn: () => void | Promise<void>) => void,
  ) {
    return (condition: boolean) => {
      return wrapTestVariant(modifier(condition));
    };
  }

  const t = validateTestFunction(config.test);
  const suiteTest = Object.assign(wrapTestVariant(t), {
    skip: wrapTestVariant(t.skip.bind(t)),
    only: wrapTestVariant(t.only.bind(t)),
    todo: wrapTestVariant(t.todo.bind(t)),
    failing: wrapTestVariant(t.failing.bind(t)),
    concurrent: wrapTestVariant(t.concurrent.bind(t)),
    serial: wrapTestVariant(t.serial.bind(t)),
    if: wrapConditional(t.if.bind(t)),
    skipIf: wrapConditional(t.skipIf.bind(t)),
    todoIf: wrapConditional(t.todoIf.bind(t)),
  }) as SuiteTestFunction;

  async function flush(): Promise<void> {
    if (!experiment) {
      return;
    }

    await summarizeAndFlush(experiment, {
      displaySummary: config.displaySummary,
    });
    experiment = undefined;
  }

  const suite: BunTestSuite = {
    test: suiteTest,
    it: suiteTest,
    flush,
  };

  // Auto-register flush hook if afterAll() was provided
  if (config.afterAll) {
    config.afterAll(() => suite.flush());
  }

  return suite;
}
