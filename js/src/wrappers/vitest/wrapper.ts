import {
  initDataset,
  initExperiment,
  type Dataset,
  type Experiment,
  type ExperimentSummary,
} from "../../logger";
import { SpanTypeAttribute } from "../../../util/index";
import type {
  TestConfig,
  TestContext,
  TestFunction,
  DescribeFunction,
  WrappedTest,
  WrappedDescribe,
  WrapperConfig,
} from "./types";

// Simple function to format experiment summary for console output
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

// Context for experiment mode - stored per describe block
interface ExperimentContext {
  dataset: Dataset<false>;
  experiment: Experiment;
  datasetExamples: Map<string, string>; // test name -> example id
}

// Global context holder (one per describe block)
let currentExperimentContext: ExperimentContext | null = null;

export function setExperimentContext(context: ExperimentContext | null) {
  currentExperimentContext = context;
}

export function getExperimentContext(): ExperimentContext | null {
  return currentExperimentContext;
}

export function wrapTest(
  originalTest: TestFunction,
  config: WrapperConfig,
): WrappedTest {
  const wrappedTest: any = function (
    name: string,
    configOrFn: TestConfig | ((context: any) => void | Promise<void>),
    maybeFn?: (context: TestContext) => void | Promise<void>,
  ) {
    const isEnhanced = typeof configOrFn !== "function";
    const testConfig = isEnhanced ? (configOrFn as TestConfig) : undefined;
    const fn = isEnhanced ? maybeFn! : (configOrFn as any);
    const experimentContext = getExperimentContext();

    // Add test data to dataset if it has input/expected
    if (experimentContext && testConfig) {
      const { input, expected, metadata, tags } = testConfig;
      if (input !== undefined || expected !== undefined) {
        // Add to dataset (will not duplicate if already exists)
        const exampleId = experimentContext.dataset.insert({
          input,
          expected,
          metadata,
          tags,
        });
        experimentContext.datasetExamples.set(name, exampleId);
      }
    }

    return originalTest(name, async (vitestContext: any) => {
      // If no experiment context, just run the test normally
      if (!experimentContext) {
        if (testConfig) {
          const params: TestContext = {
            input: testConfig.input,
            expected: testConfig.expected,
            metadata: testConfig.metadata,
          };
          return await fn({ ...vitestContext, ...params });
        } else {
          return await fn(vitestContext);
        }
      }

      // Use experiment.traced()
      return await experimentContext.experiment.traced(
        async (span) => {
          let testResult: any;
          try {
            if (testConfig) {
              const params: TestContext = {
                input: testConfig.input,
                expected: testConfig.expected,
                metadata: testConfig.metadata,
              };
              testResult = await fn({ ...vitestContext, ...params });
            } else {
              testResult = await fn(vitestContext);
            }

            // Automatically log pass feedback on success
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
            // Automatically log fail feedback on error
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
    });
  };

  // Copy over Vitest modifiers
  if (originalTest.skip) wrappedTest.skip = wrappedTest;
  if (originalTest.only) wrappedTest.only = wrappedTest;
  if (originalTest.concurrent) wrappedTest.concurrent = wrappedTest;
  if (originalTest.todo) wrappedTest.todo = originalTest.todo;
  if (originalTest.each) wrappedTest.each = originalTest.each;

  return wrappedTest as WrappedTest;
}

export function wrapDescribe(
  originalDescribe: DescribeFunction,
  config: WrapperConfig,
  afterAll?: (fn: () => void | Promise<void>) => void,
): WrappedDescribe {
  const wrappedDescribe: any = function (
    suiteName: string,
    factory: () => void,
  ) {
    return originalDescribe(suiteName, () => {
      // Initialize dataset and experiment for this describe block
      const projectName = config.projectName || suiteName;
      const dataset = initDataset({
        project: projectName,
        dataset: suiteName,
      });

      const experiment = initExperiment(projectName, {
        experiment: `${suiteName}-${new Date().toISOString()}`,
        dataset,
      });

      const context: ExperimentContext = {
        dataset,
        experiment,
        datasetExamples: new Map(),
      };

      setExperimentContext(context);

      // Run the test suite
      factory();

      // Automatically flush experiment after all tests complete
      if (afterAll) {
        afterAll(async () => {
          const ctx = getExperimentContext();
          if (!ctx) return;

          const shouldDisplaySummary = config.displaySummary ?? true;

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

          await ctx.experiment.flush();

          if (summary && shouldDisplaySummary) {
            console.log(formatExperimentSummary(summary));
          }
        });
      }

      // Note: We don't clear the context here because afterAll hooks run after this
      // The context will be cleared when a new describe block starts or the process exits
    });
  };

  // Copy over Vitest modifiers
  if (originalDescribe.skip) wrappedDescribe.skip = wrappedDescribe;
  if (originalDescribe.only) wrappedDescribe.only = wrappedDescribe;
  if (originalDescribe.concurrent) wrappedDescribe.concurrent = wrappedDescribe;
  if (originalDescribe.todo) wrappedDescribe.todo = originalDescribe.todo;
  if (originalDescribe.each) wrappedDescribe.each = originalDescribe.each;

  return wrappedDescribe as WrappedDescribe;
}
