/**
 * Next.js Edge Runtime API route for running shared test suites
 * Tests the Braintrust SDK in Next.js Edge Runtime (V8 isolates)
 */

import { NextResponse } from "next/server";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runImportVerificationTests,
  runPromptTemplatingTests,
} from "../../../../../../shared/dist/index.mjs";

import * as braintrust from "braintrust";
const { initLogger, _exportsForTestingOnly } = braintrust;

// Force Edge Runtime
export const runtime = "edge";

interface TestResponse {
  success: boolean;
  message: string;
  runtime: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  timestamp: string;
  failures?: Array<{
    testName: string;
    error?: string;
  }>;
}

/**
 * GET /api/smoke-test/edge - Run shared test suites in Edge Runtime
 */
export async function GET(): Promise<NextResponse<TestResponse>> {
  const timestamp = new Date().toISOString();

  try {
    // Setup test environment with Edge Runtime constraints
    const adapters = await setupTestEnvironment({
      initLogger,
      testingExports: _exportsForTestingOnly,
      canUseFileSystem: false, // No filesystem in Edge Runtime
      canUseCLI: false, // No CLI in Edge Runtime
      environment: "nextjs-edge-runtime",
    });

    try {
      // Run import verification tests (forces all exports to be processed)
      const importResults = await runImportVerificationTests(braintrust);

      // Run functional tests
      const functionalResults = await runBasicLoggingTests(adapters);

      // Run prompt templating tests
      const promptTemplatingResults = await runPromptTemplatingTests({
        Prompt: braintrust.Prompt,
      });

      // Combine results
      const results = [
        ...importResults,
        ...functionalResults,
        ...promptTemplatingResults,
      ];

      // Check for failures
      const failures = results.filter((r) => !r.success);

      if (failures.length > 0) {
        const response: TestResponse = {
          success: false,
          message: `${failures.length} test(s) failed in Edge Runtime`,
          runtime: "edge",
          totalTests: results.length,
          passedTests: results.length - failures.length,
          failedTests: failures.length,
          timestamp,
          failures: failures.map((f) => ({
            testName: f.testName,
            error: f.error?.message || "Unknown error",
          })),
        };

        return NextResponse.json(response, { status: 500 });
      }

      // All tests passed
      const response: TestResponse = {
        success: true,
        message: `All ${results.length} tests passed in Edge Runtime`,
        runtime: "edge",
        totalTests: results.length,
        passedTests: results.length,
        failedTests: 0,
        timestamp,
      };

      return NextResponse.json(response, { status: 200 });
    } finally {
      // Clean up test environment
      await cleanupTestEnvironment(adapters);
    }
  } catch (error) {
    const response: TestResponse = {
      success: false,
      message: `Edge Runtime test error: ${error instanceof Error ? error.message : String(error)}`,
      runtime: "edge",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      timestamp,
    };

    return NextResponse.json(response, { status: 500 });
  }
}
