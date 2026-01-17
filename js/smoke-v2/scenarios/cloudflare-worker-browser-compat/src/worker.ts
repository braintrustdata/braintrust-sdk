import * as braintrust from "braintrust/browser";
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
      initLogger: braintrust.initLogger,
      testingExports: braintrust._exportsForTestingOnly,
      canUseFileSystem: false,
      canUseCLI: false,
      environment: "cloudflare-worker-browser-compat",
    });

    try {
      const importResults = await runImportVerificationTests(braintrust);
      const functionalResults = await runBasicLoggingTests(adapters);
      const evalResult = await runEvalSmokeTest(adapters, braintrust);

      // Test Mustache template (should always work)
      const mustacheResult = await testMustacheTemplate({
        Prompt: braintrust.Prompt,
      });

      // Test Nunjucks template - expected to fail in browser builds (even with nodejs_compat_v2)
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
        message: "All shared test suites passed",
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

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/test") {
      const result = await runSharedTestSuites();

      // Serialize errors properly (Error objects don't JSON.stringify well)
      const serializedResult = {
        ...result,
        results: result.results?.map((r) => ({
          ...r,
          error: r.error
            ? {
                message: r.error.message,
                stack: r.error.stack,
                name: r.error.name,
              }
            : undefined,
        })),
        failures: result.failures?.map((r) => ({
          ...r,
          error: r.error
            ? {
                message: r.error.message,
                stack: r.error.stack,
                name: r.error.name,
              }
            : undefined,
        })),
      };

      return new Response(JSON.stringify(serializedResult, null, 2), {
        headers: { "Content-Type": "application/json" },
        status: result.success ? 200 : 500,
      });
    }

    return new Response(
      `Braintrust Cloudflare Worker Smoke Test (Browser + nodejs_compat_v2)

GET /test - Run shared test suites

This worker tests the Braintrust SDK in a Cloudflare Workers environment
using the browser entrypoint with nodejs_compat_v2 enabled.`,
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};
