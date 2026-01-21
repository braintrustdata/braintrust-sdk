// @ts-nocheck
/**
 * Deno smoke test using shared test suites
 * This test demonstrates using the shared test package across different runtimes
 */

import { assertEquals } from "@std/assert";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  runPromptTemplatingTests,
  displayTestResults,
  hasFailures,
  getFailureCount,
  type TestResult,
} from "@braintrust/smoke-test-shared";
import * as braintrust from "braintrust";

/**
 * Run the shared test suites in Deno environment
 */
export async function runSharedTestSuites() {
  const { initLogger, _exportsForTestingOnly } = braintrust;

  // Setup test environment
  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true, // Deno has filesystem access
    canUseCLI: false, // No CLI in Deno tests
    environment: "deno",
  });

  try {
    // Run tests including build resolution check
    // Deno Node should resolve to Node build (ESM format) when using import
    const importResults = await runImportVerificationTests(braintrust, {
      checkBuildResolution: true,
      expectedBuild: "node",
      expectedFormat: "esm",
    });
    const functionalResults = await runBasicLoggingTests(adapters, braintrust);
    const evalResult = await runEvalSmokeTest(adapters, braintrust);
    const promptTemplatingResults = await runPromptTemplatingTests({
      Prompt: braintrust.Prompt,
    });

    // Combine results
    const results = [
      ...importResults,
      ...functionalResults,
      evalResult,
      ...promptTemplatingResults,
    ];

    // Display results
    displayTestResults({
      scenarioName: "Deno Node Test Results",
      results,
    });

    // Check for failures
    if (hasFailures(results)) {
      throw new Error(`${getFailureCount(results)} test(s) failed`);
    }

    return results;
  } finally {
    // Clean up test environment
    await cleanupTestEnvironment(adapters);
  }
}

Deno.test("Run shared test suites", async () => {
  const results = await runSharedTestSuites();

  // Assert all tests passed
  assertEquals(
    results.filter((r) => r.status === "fail").length,
    0,
    "All tests should pass",
  );
});
