import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  runPromptTemplatingTests,
  type TestResult,
} from "../../../shared/dist/index.mjs";

// Cloudflare Worker environment bindings (empty for this test)
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

export function createWorker(
  braintrust: typeof import("braintrust") | typeof import("braintrust/browser"),
): {
  fetch(request: Request, _env: Env): Promise<Response>;
} {
  const { initLogger, _exportsForTestingOnly } = braintrust;

  async function runSharedTestSuites(): Promise<TestResponse> {
    try {
      const adapters = await setupTestEnvironment({
        initLogger,
        testingExports: _exportsForTestingOnly,
        canUseFileSystem: false,
        canUseCLI: false,
        environment: "cloudflare-worker",
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

  return {
    async fetch(request: Request, _env: Env): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/test") {
        const result = await runSharedTestSuites();
        return new Response(JSON.stringify(result, null, 2), {
          headers: { "Content-Type": "application/json" },
          status: result.success ? 200 : 500,
        });
      }

      return new Response(
        `Braintrust Cloudflare Worker Smoke Test

GET /test - Run shared test suites

This worker tests the Braintrust SDK in a Cloudflare Workers environment
using shared test suites for consistency across runtime environments.`,
        { headers: { "Content-Type": "text/plain" } },
      );
    },
  };
}
