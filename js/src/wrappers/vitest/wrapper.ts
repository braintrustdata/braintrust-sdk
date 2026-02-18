import {
  initExperiment,
  type Experiment,
  type ExperimentSummary,
  withCurrent,
} from "../../logger";
import { SpanTypeAttribute } from "../../../util/index";
import type {
  TestConfig,
  TestContext,
  TestFunction,
  BaseTestFunction,
  DescribeFunction,
  BaseDescribeFunction,
  WrappedTest,
  WrappedDescribe,
  WrapperConfig,
} from "./types";
import {
  getVitestContextManager,
  type VitestExperimentContext,
} from "./context-manager";
import { flushExperimentWithSync } from "./flush-manager";
import { runScorers } from "./scorers";

// format experiment summary for console output
export function formatExperimentSummary(summary: ExperimentSummary): string {
  const lines: string[] = [];
  lines.push("\n┌─ Braintrust Experiment Summary ─────────────────┐");
  lines.push(`│ Experiment: ${summary.experimentName}`);

  if (Object.keys(summary.scores).length > 0) {
    lines.push("│");
    lines.push("│ Scores:");
    for (const [name, score] of Object.entries(summary.scores)) {
      const percent = (score.score * 100).toFixed(2);
      lines.push(`│   ${name}: ${percent}%`);
    }
  }

  if (summary.metrics && Object.keys(summary.metrics).length > 0) {
    lines.push("│");
    lines.push("│ Metrics:");
    for (const [name, metric] of Object.entries(summary.metrics)) {
      const value = Number.isInteger(metric.metric)
        ? metric.metric.toFixed(0)
        : metric.metric.toFixed(2);
      const formatted =
        metric.unit === "$"
          ? `${metric.unit}${value}`
          : `${value}${metric.unit}`;
      lines.push(`│   ${name}: ${formatted}`);
    }
  }

  if (summary.experimentUrl) {
    lines.push("│");
    lines.push(`│ View results: ${summary.experimentUrl}`);
  }

  lines.push("└──────────────────────────────────────────────────┘\n");
  return lines.join("\n");
}

// Get the current experiment context
export function getExperimentContext(): VitestExperimentContext | null {
  return getVitestContextManager().getCurrentContext() ?? null;
}

export function wrapTest<VitestContext = unknown>(
  originalTest: TestFunction<VitestContext>,
  config: WrapperConfig,
): WrappedTest<VitestContext> {
  // Extract wrapping logic without modifier attachment to avoid recursion
  // wrapBare can accept either a full TestFunction or a BaseTestFunction (like modifiers)
  const wrapBare = (
    testFn: TestFunction<VitestContext> | BaseTestFunction<VitestContext>,
  ): WrappedTest<VitestContext> => {
    const wrapped = function (
      name: string,
      configOrFn:
        | TestConfig
        | ((context: VitestContext) => void | Promise<void>),
      maybeFn?: (context: TestContext & VitestContext) => void | Promise<void>,
    ): void {
      const isEnhanced = typeof configOrFn !== "function";
      const testConfig = isEnhanced ? configOrFn : undefined;

      // Auto-expand if inline data provided
      if (isEnhanced && testConfig?.data && Array.isArray(testConfig.data)) {
        const dataRecords = testConfig.data;
        const testFn = maybeFn;

        if (!testFn) {
          throw new Error(
            "Braintrust: test function required when using data array",
          );
        }

        // Register a test for each data record
        dataRecords.forEach((record, index) => {
          // Merge record data with config, keeping scorers
          const mergedConfig: TestConfig = {
            ...testConfig,
            input: record.input,
            expected: record.expected,
            metadata: { ...testConfig.metadata, ...record.metadata },
            tags: [
              ...(testConfig.tags || []),
              ...(record.tags || []),
            ] as string[],
            data: undefined, // Remove data to avoid recursion
          };

          // Register individual test with merged config
          wrappedTest(`${name} [${index}]`, mergedConfig, testFn);
        });

        return;
      }

      // Extract Vitest-specific options by filtering out Braintrust-specific properties
      let vitestOptions: Record<string, unknown> | undefined;
      if (testConfig) {
        const {
          input: _input,
          expected: _expected,
          metadata: _metadata,
          tags: _tags,
          scorers: _scorers,
          data: _data,
          ...rest
        } = testConfig;
        vitestOptions = rest;
      }

      // Check if we have any Vitest options to pass
      const hasVitestOptions =
        vitestOptions && Object.keys(vitestOptions).length > 0;

      // Define the test implementation
      const testImplementation = async (vitestContext: VitestContext) => {
        const experimentContext = getExperimentContext();
        const experiment = experimentContext?.experiment;

        // Emit test start event
        if (config.onProgress) {
          config.onProgress({ type: "test_start", testName: name });
        }

        const startTime = performance.now();
        let passed = false;

        try {
          // If no experiment context, just run the test normally
          if (!experiment) {
            if (testConfig && maybeFn) {
              const params: TestContext = {
                input: testConfig.input,
                expected: testConfig.expected,
                metadata: testConfig.metadata,
              };
              const context = {
                ...vitestContext,
                ...params,
              } satisfies TestContext & VitestContext;
              const result = await maybeFn(context);
              passed = true;
              return result;
            } else if (typeof configOrFn === "function") {
              const result = await configOrFn(vitestContext);
              passed = true;
              return result;
            }
            passed = true;
            return;
          }

          // Create span using startSpan
          const span = experiment.startSpan({
            name,
            spanAttributes: {
              type: SpanTypeAttribute.TASK,
            },
            event: testConfig
              ? {
                  input: testConfig.input,
                  expected: testConfig.expected,
                  metadata: testConfig.metadata,
                  tags: testConfig.tags,
                }
              : undefined,
          });

          // span is set as current for the entire test
          const result = await withCurrent(span, async () => {
            let testResult: unknown;

            try {
              if (testConfig && maybeFn) {
                const params: TestContext = {
                  input: testConfig.input,
                  expected: testConfig.expected,
                  metadata: testConfig.metadata,
                };
                const context = {
                  ...vitestContext,
                  ...params,
                } satisfies TestContext & VitestContext;
                testResult = await maybeFn(context);
              } else if (typeof configOrFn === "function") {
                testResult = await configOrFn(vitestContext);
              }

              // Run scorers if configured (on success)
              if (testConfig?.scorers && testConfig.scorers.length > 0) {
                await runScorers({
                  scorers: testConfig.scorers,
                  output: testResult,
                  expected: testConfig.expected,
                  input: testConfig.input,
                  metadata: testConfig.metadata,
                  span,
                });
              }

              // log pass feedback on success
              span.log({
                scores: {
                  pass: 1,
                },
              });

              // If test function returns a value, log it as output
              if (testResult !== undefined) {
                span.log({
                  output: testResult,
                });
              }
            } catch (error) {
              // Run scorers if configured (even on failure)
              if (testConfig?.scorers && testConfig.scorers.length > 0) {
                await runScorers({
                  scorers: testConfig.scorers,
                  output: testResult,
                  expected: testConfig.expected,
                  input: testConfig.input,
                  metadata: testConfig.metadata,
                  span,
                });
              }

              // log fail feedback on error
              span.log({
                scores: {
                  pass: 0,
                },
                metadata: {
                  error:
                    error instanceof Error
                      ? {
                          message: error.message,
                          name: error.name,
                          stack: error.stack,
                        }
                      : String(error),
                },
              });
              throw error;
            } finally {
              span.end();
            }
            return testResult;
          });
          passed = true;
          return result;
        } catch (error) {
          passed = false;
          throw error;
        } finally {
          // Emit test complete event
          const duration = performance.now() - startTime;
          // Update suite counters if we have an experiment context
          if (experimentContext) {
            if (passed) {
              experimentContext.passed = (experimentContext.passed ?? 0) + 1;
            } else {
              experimentContext.failed = (experimentContext.failed ?? 0) + 1;
            }
          }
          if (config.onProgress) {
            config.onProgress({
              type: "test_complete",
              testName: name,
              passed,
              duration,
            });
          }
        }
      };

      // Call testFn, passing vitestOptions if present
      // We use 'as any' because TypeScript's TestFunction type doesn't include the options overload,
      // but Vitest runtime supports test(name, options, fn). Pass undefined when no options.
      return (testFn as any)(
        name,
        hasVitestOptions ? vitestOptions : undefined,
        testImplementation,
      );
    };

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return wrapped as WrappedTest<VitestContext>;
  };

  const wrappedTest = wrapBare(originalTest);

  // Wrap modifiers to apply config filtering (same as base test)
  // This ensures Braintrust-specific properties are filtered out before passing to Vitest
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  wrappedTest.skip = wrapBare(originalTest.skip);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  wrappedTest.only = wrapBare(originalTest.only);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  wrappedTest.concurrent = wrapBare(originalTest.concurrent);
  if (originalTest.todo) wrappedTest.todo = originalTest.todo;
  if (originalTest.each) wrappedTest.each = originalTest.each as any;

  return wrappedTest;
}

export function wrapDescribe(
  originalDescribe: DescribeFunction,
  config: WrapperConfig,
  afterAll?: (fn: () => void | Promise<void>) => void,
): WrappedDescribe {
  // Extract wrapping logic without modifier attachment to avoid recursion
  // wrapBare can accept either a full DescribeFunction or a BaseDescribeFunction (like modifiers)
  const wrapBare = (
    describeFn: DescribeFunction | BaseDescribeFunction,
  ): WrappedDescribe => {
    const wrapped = function (suiteName: string, factory: () => void) {
      return describeFn(suiteName, () => {
        const contextManager = getVitestContextManager();
        let context: VitestExperimentContext | null = null;

        const getOrCreateContext = (): VitestExperimentContext => {
          if (!context) {
            const projectName = config.projectName || suiteName;

            const experiment = initExperiment(projectName, {
              experiment: `${suiteName}-${new Date().toISOString()}`,
            });

            context = contextManager.createChildContext(undefined, experiment);
          }
          return context;
        };

        // Lazy context getter
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const lazyContext = {
          get dataset() {
            return getOrCreateContext().dataset;
          },
          get experiment() {
            return getOrCreateContext().experiment;
          },
          get datasetExamples() {
            return getOrCreateContext().datasetExamples;
          },
          get parent() {
            return getOrCreateContext().parent;
          },
          get flushPromise() {
            return getOrCreateContext().flushPromise;
          },
          set flushPromise(value: Promise<void> | undefined) {
            if (context) context.flushPromise = value;
          },
          get flushResolved() {
            return getOrCreateContext().flushResolved;
          },
          set flushResolved(value: boolean) {
            if (context) context.flushResolved = value;
          },
        } as VitestExperimentContext;

        // Emit suite start event
        if (config.onProgress) {
          config.onProgress({ type: "suite_start", suiteName });
        }

        // Set the context for this the describe block
        contextManager.setContext(lazyContext);

        // Register the tests in the suite
        factory();

        // flush experiment after all tests complete
        if (afterAll && (config.displaySummary ?? true)) {
          afterAll(async () => {
            await flushExperimentWithSync(context, config);

            // Emit suite complete event
            if (config.onProgress) {
              config.onProgress({
                type: "suite_complete",
                suiteName,
                passed: context?.passed ?? 0,
                failed: context?.failed ?? 0,
              });
            }
          });
        }
      });
    };

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return wrapped as WrappedDescribe;
  };

  // Wrap the base describe function
  const wrappedDescribe = wrapBare(originalDescribe);

  // Wrap modifiers to apply config filtering (same as base describe)
  // This ensures consistency with test wrapping behavior
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  wrappedDescribe.skip = wrapBare(originalDescribe.skip);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  wrappedDescribe.only = wrapBare(originalDescribe.only);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  wrappedDescribe.concurrent = wrapBare(originalDescribe.concurrent);
  if (originalDescribe.todo) wrappedDescribe.todo = originalDescribe.todo;
  if (originalDescribe.each)
    wrappedDescribe.each = originalDescribe.each as any;

  return wrappedDescribe;
}
