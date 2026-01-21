const {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runImportVerificationTests,
  runPromptTemplatingTests,
  displayTestResults,
  hasFailures,
  getFailureCount,
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
    const importResults = await runImportVerificationTests(braintrust, {
      checkBuildResolution: true,
      expectedBuild: "node",
      expectedFormat: "cjs",
    });
    const functionalResults = await runBasicLoggingTests(adapters, braintrust);
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
  const { all: results } = await runSharedTestSuites();

  // Display results
  displayTestResults({
    scenarioName: "Jest Node Test Results",
    results,
  });

  // Check for failures
  const failures = results.filter((r) => r.status === "fail");
  expect(failures).toHaveLength(0);
});
