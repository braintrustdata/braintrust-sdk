// @ts-nocheck
/**
 * Deno smoke test using shared test suites, but importing the browser build.
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
    const importResults = await runImportVerificationTests(braintrust);
    const functionalResults = await runBasicLoggingTests(adapters);
    const evalResult = await runEvalSmokeTest(adapters, braintrust);
    const promptTemplatingResults = await runPromptTemplatingTests(
      { Prompt: braintrust.Prompt },
      adapters.environment,
    );

    const results = [
      ...importResults,
      ...functionalResults,
      evalResult,
      ...promptTemplatingResults,
    ];

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(`  ❌ ${failure.testName}: ${failure.error?.message}`);
      }
      throw new Error(`${failures.length} test(s) failed`);
    }

    return results;
  } finally {
    await cleanupTestEnvironment(adapters);
  }
}

Deno.test("Run shared test suites (browser build)", async () => {
  const results = await runSharedTestSuites();
  assertEquals(results.filter((r) => !r.success).length, 0);
  console.log(`\n✅ All ${results.length} tests passed`);
});
