/**
 * Next.js Node.js Runtime API route for running shared test suites
 */

import { NextResponse } from "next/server";
import {
  runTests,
  expectFailure,
  testBasicSpanLogging,
  testMultipleSpans,
  testDirectLogging,
  testJSONAttachment,
  testAsyncLocalStorageTraced,
  testNestedTraced,
  testCurrentSpan,
  testCoreLoggingExports,
  testDatasetExports,
  testPromptExports,
  testExperimentExports,
  testEvalExports,
  testTracingExports,
  testClientWrapperExports,
  testUtilityExports,
  testFunctionExports,
  testFramework2Exports,
  testIDGeneratorExports,
  testTestingExports,
  testStateManagementExports,
  testBuildResolution,
  testMustacheTemplate,
  testNunjucksTemplate,
  testEvalSmoke,
} from "../../../../../../../shared";

import * as braintrust from "braintrust";

export const runtime = "nodejs";

export async function GET() {
  const timestamp = new Date().toISOString();

  const { all, passed, failed, xfail } = await runTests({
    name: "nextjs-node",
    braintrust,
    tests: [
      testCoreLoggingExports,
      testDatasetExports,
      testPromptExports,
      testExperimentExports,
      testEvalExports,
      testTracingExports,
      testClientWrapperExports,
      testUtilityExports,
      testFunctionExports,
      testFramework2Exports,
      testIDGeneratorExports,
      testTestingExports,
      testStateManagementExports,
      testBuildResolution("node"),
      testBasicSpanLogging,
      testMultipleSpans,
      testDirectLogging,
      testJSONAttachment,
      testAsyncLocalStorageTraced,
      testNestedTraced,
      testCurrentSpan,
      testEvalSmoke,
      testMustacheTemplate,
      expectFailure(
        testNunjucksTemplate,
        (e: { message: string }) =>
          e.message.includes("requires @braintrust/template-nunjucks"),
        "Nunjucks requires separate package",
      ),
    ],
  });

  const response = {
    success: failed.length === 0,
    message:
      failed.length > 0
        ? `${failed.length} test(s) failed in Node.js Runtime`
        : `All ${all.length} tests passed in Node.js Runtime`,
    runtime: "nodejs",
    totalTests: all.length,
    passedTests: passed.length,
    failedTests: failed.length,
    xfailTests: xfail.length,
    timestamp,
    results: all,
    failures: failed.map((f) => ({
      testName: f.name,
      error: f.error?.message || "Unknown error",
    })),
  };

  return NextResponse.json(response, { status: response.success ? 200 : 500 });
}
