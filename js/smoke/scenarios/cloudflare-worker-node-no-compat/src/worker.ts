import * as braintrust from "braintrust/node";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  runPromptTemplatingTests,
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
      environment: "cloudflare-worker-node-no-compat",
    });

    try {
      // Test import verification including build resolution check
      // Node.js build (ESM format) should be used (though may fail due to missing Node.js APIs)
      const importResults = await runImportVerificationTests(braintrust, {
        checkBuildResolution: true,
        expectedBuild: "node",
        expectedFormat: "esm",
      });
      const functionalResults = await runBasicLoggingTests(
        adapters,
        braintrust,
      );
      const evalResult = await runEvalSmokeTest(adapters, braintrust);
      const promptTemplatingResults = await runPromptTemplatingTests({
        Prompt: braintrust.Prompt,
      });

      const results = [
        ...importResults,
        ...functionalResults,
        evalResult,
        ...promptTemplatingResults,
      ];

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
      `Braintrust Cloudflare Worker Smoke Test (Node.js + No Compat)

GET /test - Run shared test suites

This worker tests the Braintrust SDK in a Cloudflare Workers environment.
Should use Node.js build from package.json exports (may fail without nodejs_compat_v2).`,
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};
