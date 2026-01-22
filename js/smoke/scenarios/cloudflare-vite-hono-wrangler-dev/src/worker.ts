import { Hono } from "hono";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  testMustacheTemplate,
  testNunjucksTemplate,
  type TestResult,
} from "../../../shared";

import * as braintrust from "braintrust";
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

async function runSharedTestSuites(): Promise<TestResponse> {
  try {
    const adapters = await setupTestEnvironment({
      initLogger,
      testingExports: _exportsForTestingOnly,
      canUseFileSystem: false,
      canUseCLI: false,
      environment: "cloudflare-vite-hono",
    });

    try {
      // Vite bundler should automatically resolve browser build (ESM format) when importing from "braintrust"
      const importResults = await runImportVerificationTests(braintrust, {
        checkBuildResolution: true,
        expectedBuild: "browser",
        expectedFormat: "esm",
      });
      const functionalResults = await runBasicLoggingTests(adapters);
      const evalResult = await runEvalSmokeTest(adapters, braintrust);

      // Test Mustache template (should always work)
      const mustacheResult = await testMustacheTemplate({
        Prompt: braintrust.Prompt,
      });

      // Test Nunjucks template - expected to fail in browser builds
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

      // Filter out expected failures when counting actual failures
      const failures = results.filter((r) => r.status === "fail");

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
  c.text(`Braintrust Cloudflare Vite + Hono Smoke Test

GET /api/ - Basic API endpoint
GET /api/test - Run shared test suites

This worker tests the Braintrust SDK in a Vite + Hono + Cloudflare Workers environment.
Vite should automatically resolve the browser build from package.json exports.`),
);

app.get("/api/", (c) => c.json({ name: "Braintrust", framework: "Hono" }));

app.get("/api/test", async (c) => {
  const result = await runSharedTestSuites();
  return c.json(result, result.success ? 200 : 500);
});

export default app;
