/**
 * Runs shared test suites to verify SDK exports and basic functionality
 */

import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runImportVerificationTests,
} from "../../../shared/dist/index.js";

import { initLogger, _exportsForTestingOnly } from "braintrust";

async function runSharedTestSuites() {
  console.log("Running shared test suites in otel-v1 scenario...\n");

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
    // Run import verification tests
    console.log("Running import verification tests...");
    const importResults = await runImportVerificationTests(braintrust);

    // Run functional tests
    console.log("\nRunning functional tests...");
    const functionalResults = await runBasicLoggingTests(adapters, braintrust);

    // Combine results
    const results = [...importResults, ...functionalResults];

    // Verify all tests passed
    const failures = results.filter((r) => r.status === "fail");

    if (failures.length > 0) {
      console.error("\n❌ Test failures:");
      for (const failure of failures) {
        console.error(`  ${failure.name}: ${failure.error?.message}`);
        if (failure.error?.stack) {
          console.error(`    ${failure.error.stack}`);
        }
      }
      throw new Error(`${failures.length} test(s) failed`);
    }

    // Log results by category
    console.log("\n✅ All shared test suites passed!\n");
    console.log("Import Verification Tests:");
    for (const result of importResults) {
      console.log(`  ✓ ${result.name}: ${result.message}`);
    }
    console.log("\nFunctional Tests:");
    for (const result of functionalResults) {
      console.log(`  ✓ ${result.name}: ${result.message}`);
    }

    console.log(`\nTotal: ${results.length} tests passed`);

    return results;
  } finally {
    // Clean up test environment
    await cleanupTestEnvironment(adapters);
  }
}

runSharedTestSuites()
  .then(() => {
    console.log("\n✅ Shared test suite execution completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Shared test suite execution failed:", error);
    process.exit(1);
  });
