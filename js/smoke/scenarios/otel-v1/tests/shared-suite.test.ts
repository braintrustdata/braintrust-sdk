/**
 * Runs shared test suites to verify SDK exports and basic functionality
 */

import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runImportVerificationTests,
  displayTestResults,
  hasFailures,
  getFailureCount,
} from "../../../shared/dist/index.js";

import { initLogger, _exportsForTestingOnly } from "braintrust";

async function runSharedTestSuites() {
  // Import Braintrust module for import verification
  const braintrust = await import("braintrust");

  // Setup test environment
  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true,
    canUseCLI: true,
    environment: "otel-v1",
  });

  try {
    // Run tests including build resolution check
    // Node.js should resolve to Node build (ESM format) when using import
    const importResults = await runImportVerificationTests(braintrust, {
      expectedBuild: "node",
      expectedFormat: "esm",
    });
    const functionalResults = await runBasicLoggingTests(adapters, braintrust);

    // Combine results
    const results = [...importResults, ...functionalResults];

    // Display results
    displayTestResults({
      scenarioName: "OTEL v1 Test Results",
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

runSharedTestSuites()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test execution failed:", error.message);
    process.exit(1);
  });
