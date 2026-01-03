#!/usr/bin/env tsx

/**
 * Test script to preview CLI output formatting without running actual experiments.
 *
 * Usage:
 *   pnpm tsx scripts/test-output.ts
 *   pnpm tsx scripts/test-output.ts --with-comparison
 *   pnpm tsx scripts/test-output.ts --with-metrics
 *   pnpm tsx scripts/test-output.ts --with-progress
 */

import { formatExperimentSummary } from "../src/framework";
import type { ExperimentSummary } from "../src/logger";
import { BarProgressReporter } from "../src/cli/progress";

function createSampleSummary(options: {
  withComparison?: boolean;
  withMetrics?: boolean;
}): ExperimentSummary {
  const summary: ExperimentSummary = {
    projectName: "my-project",
    experimentName: "test-experiment",
    experimentId: "exp-123",
    projectId: "proj-456",
    experimentUrl:
      "https://www.braintrust.dev/app/my-org/p/my-project/experiments/test-experiment",
    projectUrl: "https://www.braintrust.dev/app/my-org/p/my-project",
    scores: {
      accuracy: {
        name: "Accuracy",
        score: 0.95,
        diff: options.withComparison ? 0.02 : undefined,
        improvements: options.withComparison ? 15 : 0,
        regressions: options.withComparison ? 3 : 0,
      },
      factuality: {
        name: "Factuality",
        score: 0.87,
        diff: options.withComparison ? -0.01 : undefined,
        improvements: options.withComparison ? 8 : 0,
        regressions: options.withComparison ? 12 : 0,
      },
    },
  };

  if (options.withMetrics) {
    summary.metrics = {
      duration: {
        name: "Duration",
        metric: 1.23,
        unit: "s",
        diff: options.withComparison ? -0.15 : undefined,
        improvements: options.withComparison ? 10 : 0,
        regressions: options.withComparison ? 5 : 0,
      },
      llm_duration: {
        name: "LLM duration",
        metric: 0.45,
        unit: "s",
        diff: options.withComparison ? -0.08 : undefined,
        improvements: options.withComparison ? 12 : 0,
        regressions: options.withComparison ? 3 : 0,
      },
      prompt_tokens: {
        name: "Prompt tokens",
        metric: 4282,
        unit: "",
        diff: options.withComparison ? 0.035 : undefined,
        improvements: options.withComparison ? 0 : 0,
        regressions: options.withComparison ? 0 : 0,
      },
      completion_tokens: {
        name: "Completion tokens",
        metric: 310,
        unit: "",
        diff: options.withComparison ? -0.08 : undefined,
        improvements: options.withComparison ? 0 : 0,
        regressions: options.withComparison ? 0 : 0,
      },
      total_tokens: {
        name: "Total tokens",
        metric: 4592,
        unit: "",
        diff: options.withComparison ? 0.027 : undefined,
        improvements: options.withComparison ? 0 : 0,
        regressions: options.withComparison ? 0 : 0,
      },
      estimated_cost: {
        name: "Estimated cost",
        metric: 0.01,
        unit: "$",
        diff: options.withComparison ? 0.2 : undefined,
        improvements: options.withComparison ? 0 : 0,
        regressions: options.withComparison ? 0 : 0,
      },
    };
  }

  if (options.withComparison) {
    summary.comparisonExperimentName = "baseline-experiment";
  }

  return summary;
}

async function simulateProgress(evaluatorName: string, total: number) {
  const progressReporter = new BarProgressReporter();
  progressReporter.start(evaluatorName, total);

  // Simulate progress with random delays
  for (let i = 0; i < total; i++) {
    await new Promise((resolve) =>
      setTimeout(resolve, 50 + Math.random() * 100),
    );
    progressReporter.increment(evaluatorName);
  }

  progressReporter.stop();
}

async function main() {
  const args = process.argv.slice(2);
  const withComparison = args.includes("--with-comparison");
  const withMetrics = args.includes("--with-metrics");
  const withProgress = args.includes("--with-progress");

  console.log("\n" + "=".repeat(60));
  console.log("Testing CLI Output Formatting");
  console.log("=".repeat(60) + "\n");

  // Test 1: Basic summary
  console.log("1. Basic Summary (scores only):");
  console.log("-".repeat(60));

  if (withProgress) {
    await simulateProgress("test-experiment", 10);
  }

  const basicSummary = createSampleSummary({});
  console.log(formatExperimentSummary(basicSummary));
  console.log("\n");

  // Test 2: With comparison
  if (withComparison) {
    console.log("2. Summary with Comparison:");
    console.log("-".repeat(60));

    if (withProgress) {
      await simulateProgress("test-experiment", 15);
    }

    const comparisonSummary = createSampleSummary({ withComparison: true });
    console.log(formatExperimentSummary(comparisonSummary));
    console.log("\n");
  }

  // Test 3: With metrics
  if (withMetrics) {
    console.log("3. Summary with Metrics:");
    console.log("-".repeat(60));

    if (withProgress) {
      await simulateProgress("test-experiment", 20);
    }

    const metricsSummary = createSampleSummary({ withMetrics: true });
    console.log(formatExperimentSummary(metricsSummary));
    console.log("\n");
  }

  // Test 4: Full summary
  console.log("4. Full Summary (scores + metrics + comparison):");
  console.log("-".repeat(60));

  if (withProgress) {
    await simulateProgress("test-experiment", 25);
  }

  const fullSummary = createSampleSummary({
    withComparison: true,
    withMetrics: true,
  });
  console.log(formatExperimentSummary(fullSummary));
  console.log("\n");

  console.log("=".repeat(60));
  console.log(
    "Done! Use --with-comparison, --with-metrics, and --with-progress flags to see more variations.",
  );
  console.log("=".repeat(60) + "\n");
}

main();
