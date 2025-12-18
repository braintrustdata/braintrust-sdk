/**
 * Jest smoke test using shared test suites
 * This test demonstrates using the shared test package with Jest
 */

const {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runImportVerificationTests,
  runPromptTemplatingTests,
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

    // Run prompt templating tests
    const promptTemplatingResults = await runPromptTemplatingTests({
      Prompt: braintrust.Prompt,
    });

    // Combine results
    const results = [
      ...importResults,
      ...functionalResults,
      ...promptTemplatingResults,
    ];

    return {
      all: results,
      import: importResults,
      functional: functionalResults,
      templating: promptTemplatingResults,
    };
  } finally {
    // Clean up test environment
    await cleanupTestEnvironment(adapters);
  }
}

test("shared test suites pass in Jest", async () => {
  const {
    all: results,
    import: importResults,
    functional: functionalResults,
    templating: promptTemplatingResults,
  } = await runSharedTestSuites();

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

  // Log success summary
  console.log(`\n✅ All ${results.length} shared test suites passed!\n`);
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
});
