/**
 * Node.js CJS smoke test using shared test suites
 * This test demonstrates using the shared test package in Node.js CommonJS mode
 */

import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  runPromptTemplatingTests,
  type TestResult,
} from "../../shared/dist/index.js";

import { initLogger, _exportsForTestingOnly } from "braintrust";

/**
 * Run the shared test suites in Node.js CJS environment
 */
async function runSharedTestSuites() {
  console.log("Running shared test suites in Node.js CJS mode...\n");

  // Import Braintrust module for import verification
  const braintrust = await import("braintrust");

  // Setup test environment
  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true, // Node.js has filesystem access
    canUseCLI: true, // Node.js can invoke CLI
    environment: "node-cjs",
  });

  try {
    // Run import verification tests first (forces all exports to be processed)
    console.log("Running import verification tests...");
    const importResults = await runImportVerificationTests(braintrust);

    // Run functional tests
    console.log("\nRunning functional tests...");
    const functionalResults = await runBasicLoggingTests(adapters);

    // Run eval smoke test
    console.log("\nRunning eval smoke test...");
    const evalResult = await runEvalSmokeTest(adapters, braintrust);

    // Run prompt templating tests
    console.log("\nRunning prompt templating tests...");
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

    // Verify all tests passed
    const failures = results.filter((r) => !r.success);

    if (failures.length > 0) {
      console.error("\n❌ Test failures:");
      for (const failure of failures) {
        console.error(`  ${failure.testName}: ${failure.error?.message}`);
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
      console.log(`  ✓ ${result.testName}: ${result.message}`);
    }
    console.log("\nFunctional Tests:");
    for (const result of functionalResults) {
      console.log(`  ✓ ${result.testName}: ${result.message}`);
    }
    console.log("\nPrompt Templating Tests:");
    for (const result of promptTemplatingResults) {
      console.log(`  ✓ ${result.testName}: ${result.message}`);
    }

    console.log(`\nTotal: ${results.length} tests passed`);

    return results;
  } finally {
    // Clean up test environment
    await cleanupTestEnvironment(adapters);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runSharedTestSuites()
    .then(() => {
      console.log("\n✅ Shared test suite execution completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Shared test suite execution failed:", error);
      process.exit(1);
    });
}

export { runSharedTestSuites };
