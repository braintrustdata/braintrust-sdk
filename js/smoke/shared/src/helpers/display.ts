/**
 * Standardized test result display utilities
 */

import type { TestResult } from "./types";

export interface DisplayTestResultsOptions {
  scenarioName: string;
  results: TestResult[];
  verbose?: boolean;
}

/**
 * Display test results in standardized format
 */
export function displayTestResults(options: DisplayTestResultsOptions): void {
  const { scenarioName, results, verbose = false } = options;

  console.log(`\n=== ${scenarioName} ===\n`);

  const passedTests = results.filter((r) => r.status === "pass").length;
  const xfailTests = results.filter((r) => r.status === "xfail").length;
  const totalTests = results.length;

  console.log(`Tests: ${passedTests}/${totalTests} passed`);
  if (xfailTests > 0) {
    console.log(`Expected failures: ${xfailTests}`);
  }
  console.log();

  for (const result of results) {
    const statusSymbol =
      result.status === "pass" ? "✓" : result.status === "xfail" ? "⊘" : "✗";
    const statusColor =
      result.status === "pass"
        ? "\x1b[32m"
        : result.status === "xfail"
          ? "\x1b[33m"
          : "\x1b[31m";
    const resetColor = "\x1b[0m";

    console.log(`${statusColor}${statusSymbol}${resetColor} ${result.name}`);

    if (result.status === "fail" && result.error) {
      const errorMsg = result.error.message || String(result.error);
      console.log(`  Error: ${errorMsg}`);

      if (result.error.stack) {
        const stackLines = result.error.stack.split("\n");
        if (verbose) {
          console.log(`  Stack trace:`);
          for (const line of stackLines) {
            console.log(`    ${line}`);
          }
        } else {
          const relevantLines = stackLines.slice(0, 3);
          for (const line of relevantLines) {
            console.log(`  ${line}`);
          }
        }
      }
    }

    if (result.status === "xfail" && result.message) {
      console.log(`  ${result.message}`);
    }
  }

  console.log();
}

/**
 * Check if there are any real failures (excluding xfail)
 */
export function hasFailures(results: TestResult[]): boolean {
  return results.some((r) => r.status === "fail");
}

/**
 * Get failure count (excluding xfail)
 */
export function getFailureCount(results: TestResult[]): number {
  return results.filter((r) => r.status === "fail").length;
}

/**
 * Get summary statistics
 */
export function getTestStats(results: TestResult[]): {
  total: number;
  passed: number;
  failed: number;
  xfail: number;
} {
  return {
    total: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    xfail: results.filter((r) => r.status === "xfail").length,
  };
}
