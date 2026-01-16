// @ts-nocheck
/**
 * Deno smoke test using shared test suites
 * This test demonstrates using the shared test package across different runtimes
 */

import { assertEquals } from "jsr:@std/assert@^1.0.14";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  runPromptTemplatingTests,
  type TestResult,
} from "../../../shared/dist/index.mjs";
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
    // Run import verification tests first (forces bundler to process all exports)
    const importResults = await runImportVerificationTests(braintrust);

    // Run functional tests
    const functionalResults = await runBasicLoggingTests(adapters);

    // Run eval smoke test
    const evalResult = await runEvalSmokeTest(adapters, braintrust);

    // Run prompt templating tests
    const promptTemplatingResults = await runPromptTemplatingTests(
      {
        Prompt: braintrust.Prompt,
      },
      adapters.environment,
    );

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
      console.error("Test failures:");
      for (const failure of failures) {
        console.error(`  ❌ ${failure.testName}: ${failure.error?.message}`);
      }
      throw new Error(`${failures.length} test(s) failed`);
    }

    // Log results by category
    console.log("✅ All shared test suites passed:");
    console.log("\nImport Verification:");
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
    results.filter((r) => !r.success).length,
    0,
    "All tests should pass",
  );

  // Log test count for visibility
  console.log(`\n✅ All ${results.length} tests passed`);
});
