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
  type TestResult,
} from "../../shared/dist/index.mjs";

/**
 * Run the shared test suites in Deno environment
 */
export async function runSharedTestSuites() {
  const buildDir = Deno.env.get("BRAINTRUST_BUILD_DIR");
  if (!buildDir) {
    throw new Error("BRAINTRUST_BUILD_DIR environment variable is not set");
  }

  // Dynamically import Braintrust from the build directory
  const { initLogger, _exportsForTestingOnly } = await import(
    `file://${buildDir}`
  );

  // Setup test environment
  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true, // Deno has filesystem access
    canUseCLI: false, // No CLI in Deno tests
    environment: "deno",
  });

  try {
    // Run all basic logging tests
    const results = await runBasicLoggingTests(adapters);

    // Verify all tests passed
    const failures = results.filter((r) => !r.success);

    if (failures.length > 0) {
      console.error("Test failures:");
      for (const failure of failures) {
        console.error(`  ❌ ${failure.testName}: ${failure.error?.message}`);
      }
      throw new Error(`${failures.length} test(s) failed`);
    }

    // Log results
    console.log("✅ All shared test suites passed:");
    for (const result of results) {
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

  // Assert we ran at least 3 tests (from basic-logging suite)
  assertEquals(
    results.length >= 3,
    true,
    `Expected at least 3 tests, got ${results.length}`,
  );
});
