import { initExperiment, type ExperimentSummary } from "../../logger";
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

// Current experiment context
export function getExperimentContext(): VitestExperimentContext | null {
  return getVitestContextManager().getCurrentContext() ?? null;
}

export function wrapTest<VitestContext = unknown>(
  originalTest: TestFunction<VitestContext>,
  config: WrapperConfig,
): WrappedTest<VitestContext> {
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

        // Register test for each data record
        dataRecords.forEach((record, index) => {
          const mergedConfig: TestConfig = {
            ...testConfig,
            input: record.input,
            expected: record.expected,
            metadata: { ...testConfig.metadata, ...record.metadata },
            tags: [
              ...(testConfig.tags || []),
              ...(record.tags || []),
            ] as string[],
            data: undefined,
          };

          wrappedTest(`${name} [${index}]`, mergedConfig, testFn);
        });

        return;
      }

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

      // separate vitest options
      const hasVitestOptions =
        vitestOptions && Object.keys(vitestOptions).length > 0;

      // Capture context at registration time (during wrapDescribe factory execution)
      // as a fallback. Vitest's async test runner creates new async contexts for
      // each test, so AsyncLocalStorage.enterWith() set in the describe factory
      // doesn't propagate to test execution. The captured context is used when
      // getExperimentContext() returns null at runtime.
      const registrationContext = getExperimentContext();

      const testImplementation = async (vitestContext: VitestContext) => {
        const experimentContext = getExperimentContext() ?? registrationContext;
        const experiment = experimentContext?.experiment;

        if (config.onProgress) {
          config.onProgress({ type: "test_start", testName: name });
        }

        const startTime = performance.now();
        let passed = false;

        try {
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

          const result = await experiment.traced(
            async (span) => {
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

                // Run scorers if configured
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
                // Run scorers on failures
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
              }
              return testResult;
            },
            {
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
            },
          );
          passed = true;
          return result;
        } catch (error) {
          passed = false;
          throw error;
        } finally {
          const duration = performance.now() - startTime;
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

      return (testFn as any)(
        name,
        hasVitestOptions ? vitestOptions : undefined,
        testImplementation,
      );
    };
    return wrapped as WrappedTest<VitestContext>;
  };

  const wrappedTest = wrapBare(originalTest);

  wrappedTest.skip = wrapBare(originalTest.skip);
  wrappedTest.only = wrapBare(originalTest.only);
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

        if (config.onProgress) {
          config.onProgress({ type: "suite_start", suiteName });
        }

        contextManager.setContext(lazyContext);

        factory();

        if (afterAll && (config.displaySummary ?? true)) {
          afterAll(async () => {
            await flushExperimentWithSync(context, config);

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

  const wrappedDescribe = wrapBare(originalDescribe);
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
