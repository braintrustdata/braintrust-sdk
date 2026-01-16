/**
 * Vite + React + Hono + Cloudflare Worker smoke test using shared test suites
 * This test demonstrates using the Braintrust SDK with Hono routing framework
 */

import { Hono } from "hono";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  runPromptTemplatingTests,
  type TestResult,
} from "../../../../shared/dist/index.mjs";

import * as braintrust from "braintrust/browser";
const { initLogger, _exportsForTestingOnly } = braintrust;

const app = new Hono<{ Bindings: Env }>();

interface Env {}

interface TestResponse {
  success: boolean;
  message: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  results?: TestResult[];
  failures?: TestResult[];
}

/**
 * Run the shared test suites in Hono + Cloudflare Worker environment
 */
async function runSharedTestSuites(): Promise<TestResponse> {
  try {
    const adapters = await setupTestEnvironment({
      initLogger,
      testingExports: _exportsForTestingOnly,
      canUseFileSystem: false,
      canUseCLI: false,
      environment: "vite-react-hono",
    });

    try {
      const importResults = await runImportVerificationTests(braintrust);
      const functionalResults = await runBasicLoggingTests(adapters);
      const evalResult = await runEvalSmokeTest(adapters, braintrust);
      const promptTemplatingResults = await runPromptTemplatingTests(
        {
          Prompt: braintrust.Prompt,
        },
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
        return {
          success: false,
          message: `${failures.length} test(s) failed`,
          totalTests: results.length,
          passedTests: results.length - failures.length,
          failedTests: failures.length,
          results,
          failures,
        };
      }

      return {
        success: true,
        message: "All shared test suites passed in Vite + Hono environment",
        totalTests: results.length,
        passedTests: results.length,
        failedTests: 0,
        results,
      };
    } finally {
      await cleanupTestEnvironment(adapters);
    }
  } catch (error) {
    return {
      success: false,
      message: `Error during smoke test: ${error instanceof Error ? error.message : String(error)}`,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
    };
  }
}

app.get("/", (c) =>
  c.text(`Braintrust Vite + React + Hono Smoke Test

GET /api/ - Basic API endpoint
GET /api/test - Run shared test suites

This worker tests the Braintrust SDK in a Vite + Hono + Cloudflare Workers environment.`),
);

app.get("/api/", (c) => c.json({ name: "Braintrust", framework: "Hono" }));

app.get("/api/test", async (c) => {
  const result = await runSharedTestSuites();

  return c.json(result, result.success ? 200 : 500);
});

export default app;
