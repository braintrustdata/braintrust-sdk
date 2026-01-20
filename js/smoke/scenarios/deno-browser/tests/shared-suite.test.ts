// @ts-nocheck
/**
 * Deno smoke test using shared test suites, but importing the browser build.
 */

import { assertEquals } from "@std/assert";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  testMustacheTemplate,
  testNunjucksTemplate,
  displayTestResults,
  hasFailures,
  getFailureCount,
  type TestResult,
} from "@braintrust/smoke-test-shared";
import * as braintrust from "braintrust/browser";

export async function runSharedTestSuites(): Promise<TestResult[]> {
  const { initLogger, _exportsForTestingOnly } = braintrust;

  const adapters = await setupTestEnvironment({
    initLogger,
    testingExports: _exportsForTestingOnly,
    canUseFileSystem: true,
    canUseCLI: false,
    environment: "browser",
  });

  try {
    // Run tests
    const importResults = await runImportVerificationTests(braintrust);
    const functionalResults = await runBasicLoggingTests(adapters, braintrust);
    const evalResult = await runEvalSmokeTest(adapters, braintrust);

    const mustacheResult = await testMustacheTemplate({
      Prompt: braintrust.Prompt,
    });

    const nunjucksResult = await testNunjucksTemplate({
      Prompt: braintrust.Prompt,
    });
    const nunjucksResultHandled =
      nunjucksResult.status === "fail" &&
      nunjucksResult.error?.message.includes(
        "Nunjucks templating is not supported",
      )
        ? {
            ...nunjucksResult,
            status: "xfail" as const,
            message:
              "Expected failure: Nunjucks not supported in browser build",
          }
        : nunjucksResult;

    const results = [
      ...importResults,
      ...functionalResults,
      evalResult,
      mustacheResult,
      nunjucksResultHandled,
    ];

    // Display results
    displayTestResults({
      scenarioName: "Deno Browser Test Results",
      results,
    });

    // Check for failures
    if (hasFailures(results)) {
      throw new Error(`${getFailureCount(results)} test(s) failed`);
    }

    return results;
  } finally {
    await cleanupTestEnvironment(adapters);
  }
}

Deno.test("Run shared test suites (browser build)", async () => {
  const results = await runSharedTestSuites();
  assertEquals(results.filter((r) => r.status === "fail").length, 0);
});
