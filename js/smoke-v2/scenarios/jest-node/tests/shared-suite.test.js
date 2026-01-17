const {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runImportVerificationTests,
  runPromptTemplatingTests,
} = require("../../../shared/dist/index.js");

const braintrust = require("braintrust");
const { initLogger, _exportsForTestingOnly } = braintrust;

async function runSharedTestSuites() {
  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true,
    canUseCLI: true,
    environment: "jest",
  });

  try {
    const importResults = await runImportVerificationTests(braintrust);
    const functionalResults = await runBasicLoggingTests(adapters);
    const promptTemplatingResults = await runPromptTemplatingTests({
      Prompt: braintrust.Prompt,
    });

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

  const failures = results.filter((r) => r.status === "fail");

  if (failures.length > 0) {
    console.error("Test failures:");
    for (const failure of failures) {
      console.error(`  ❌ ${failure.name}: ${failure.error?.message}`);
      if (failure.error?.stack) {
        console.error(`    ${failure.error.stack}`);
      }
    }
  }

  expect(failures).toHaveLength(0);

  console.log(`\n✅ All ${results.length} shared test suites passed!\n`);
  console.log("Import Verification Tests:");
  for (const result of importResults) {
    console.log(`  ✓ ${result.name}: ${result.message}`);
  }
  console.log("\nFunctional Tests:");
  for (const result of functionalResults) {
    console.log(`  ✓ ${result.name}: ${result.message}`);
  }
  console.log("\nPrompt Templating Tests:");
  for (const result of promptTemplatingResults) {
    console.log(`  ✓ ${result.name}: ${result.message}`);
  }
});
