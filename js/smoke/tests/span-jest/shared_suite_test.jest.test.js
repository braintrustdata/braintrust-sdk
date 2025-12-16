/**
 * Jest smoke test using shared test suites
 * This test demonstrates using the shared test package with Jest
 */

const {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runImportVerificationTests,
} = require("../../shared/dist/index.js");

const braintrust = require("braintrust");
const { initLogger, _exportsForTestingOnly } = braintrust;

/**
 * Run the shared test suites in Jest environment
 */
async function runSharedTestSuites() {
  // Setup test environment
  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true, // Jest has filesystem access
    canUseCLI: true, // Jest can invoke CLI
    environment: "jest",
  });

  try {
    // Run import verification tests first (forces all exports to be processed)
    const importResults = await runImportVerificationTests(braintrust);

    // Run functional tests
    const functionalResults = await runBasicLoggingTests(adapters);

    // Combine results
    const results = [...importResults, ...functionalResults];

    return results;
  } finally {
    // Clean up test environment
    await cleanupTestEnvironment(adapters);
  }
}

test("shared test suites pass in Jest", async () => {
  const results = await runSharedTestSuites();

  // Verify all tests passed
  const failures = results.filter((r) => !r.success);

  if (failures.length > 0) {
    console.error("Test failures:");
    for (const failure of failures) {
      console.error(`  ❌ ${failure.testName}: ${failure.error?.message}`);
    }
  }

  // Jest assertions
  expect(failures).toHaveLength(0);

  // Verify we ran at least 16 tests (13 import verification + 3 functional)
  expect(results.length).toBeGreaterThanOrEqual(16);

  // Log success summary
  console.log(`\n✅ All ${results.length} shared test suites passed!\n`);
  console.log("Import Verification Tests:");
  const importResults = results.slice(0, 13);
  for (const result of importResults) {
    console.log(`  ✓ ${result.testName}: ${result.message}`);
  }
  console.log("\nFunctional Tests:");
  const functionalResults = results.slice(13);
  for (const result of functionalResults) {
    console.log(`  ✓ ${result.testName}: ${result.message}`);
  }
});
