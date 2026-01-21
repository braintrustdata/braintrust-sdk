/**
 * Next.js Node.js Runtime API route for running shared test suites
 * Tests the Braintrust SDK in Next.js Node.js Runtime
 */

import { NextResponse } from "next/server";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  runPromptTemplatingTests,
} from "../../../../../../../shared";

import * as braintrust from "braintrust";
const { initLogger, _exportsForTestingOnly } = braintrust;

// Force Node.js Runtime
export const runtime = "nodejs";

interface TestResponse {
  success: boolean;
  message: string;
  runtime: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  timestamp: string;
  results?: Array<{
    name: string;
    status: "pass" | "fail" | "xfail";
    error?: { message: string };
    message?: string;
  }>;
  failures?: Array<{
    testName: string;
    error?: string;
  }>;
}

/**
 * GET /api/smoke-test/node - Run shared test suites in Node.js Runtime
 */
export async function GET(): Promise<NextResponse<TestResponse>> {
  const timestamp = new Date().toISOString();

  try {
    // Setup test environment with Node.js Runtime constraints
    const adapters = await setupTestEnvironment({
      initLogger,
      testingExports: _exportsForTestingOnly,
      canUseFileSystem: false, // API routes shouldn't rely on filesystem
      canUseCLI: false, // No CLI in API routes
      environment: "nextjs-nodejs-runtime",
    });

    try {
      // Run import verification tests including build resolution check
      // Next.js Node.js runtime should resolve to Node build (ESM format)
      const importResults = await runImportVerificationTests(braintrust, {
        checkBuildResolution: true,
        expectedBuild: "node",
        expectedFormat: "esm",
      });

      // Run functional tests
      const functionalResults = await runBasicLoggingTests(
        adapters,
        braintrust,
      );

      // Run eval smoke test
      const evalResult = await runEvalSmokeTest(adapters, braintrust);

      // Run prompt templating tests
      const promptTemplatingResults = await runPromptTemplatingTests({
        Prompt: braintrust.Prompt,
      });

      // Combine results
      const results = [
        ...importResults,
        ...functionalResults,
        evalResult,
        ...promptTemplatingResults,
      ];

      // Check for failures
      const failures = results.filter((r) => r.status === "fail");

      if (failures.length > 0) {
        const response: TestResponse = {
          success: false,
          message: `${failures.length} test(s) failed in Node.js Runtime`,
          runtime: "nodejs",
          totalTests: results.length,
          passedTests: results.length - failures.length,
          failedTests: failures.length,
          timestamp,
          results,
          failures: failures.map((f) => ({
            testName: f.name,
            error: f.error?.message || "Unknown error",
          })),
        };

        return NextResponse.json(response, { status: 500 });
      }

      // All tests passed
      const response: TestResponse = {
        success: true,
        message: `All ${results.length} tests passed in Node.js Runtime`,
        runtime: "nodejs",
        totalTests: results.length,
        passedTests: results.length,
        failedTests: 0,
        timestamp,
        results,
      };

      return NextResponse.json(response, { status: 200 });
    } finally {
      // Clean up test environment
      await cleanupTestEnvironment(adapters);
    }
  } catch (error) {
    const response: TestResponse = {
      success: false,
      message: `Node.js Runtime test error: ${error instanceof Error ? error.message : String(error)}`,
      runtime: "nodejs",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      timestamp,
    };

    return NextResponse.json(response, { status: 500 });
  }
}
