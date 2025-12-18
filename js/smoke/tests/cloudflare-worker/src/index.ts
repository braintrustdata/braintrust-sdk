/**
 * Cloudflare Worker smoke test using shared test suites
 * This test demonstrates using the shared test package in Cloudflare Workers
 */

import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runImportVerificationTests,
  type TestResult,
} from "../../../shared/dist/index.mjs";

import * as braintrust from "braintrust";
const { initLogger, _exportsForTestingOnly } = braintrust;

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

/**
 * Run the shared test suites in Cloudflare Worker environment
 */
async function runSharedTestSuites(): Promise<TestResponse> {
  try {
    // Setup test environment
    const adapters = await setupTestEnvironment({
      initLogger,
      testingExports: _exportsForTestingOnly,
      canUseFileSystem: false, // No filesystem in Workers
      canUseCLI: false, // No CLI in Workers
      environment: "cloudflare-worker",
    });

    try {
      // Run import verification tests first (forces all exports to be processed)
      const importResults = await runImportVerificationTests(braintrust);

      // Run functional tests
      const functionalResults = await runBasicLoggingTests(adapters);

      // Combine results
      const results = [...importResults, ...functionalResults];

      // Verify all tests passed
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
      // Clean up test environment
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
      {
        headers: { "Content-Type": "text/plain" },
      },
    );
  },
};
