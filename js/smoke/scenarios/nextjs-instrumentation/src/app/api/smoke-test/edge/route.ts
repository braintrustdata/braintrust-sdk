/**
 * Next.js Edge Runtime API route for running shared test suites
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

export const runtime = "edge";

export async function GET() {
  const timestamp = new Date().toISOString();

  const { all, passed, failed, xfail } = await runTests({
    name: "nextjs-edge",
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
      testBuildResolution,
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
        (e) => e.message.includes("Nunjucks templating is not supported"),
        "Nunjucks not supported in Edge Runtime",
      ),
    ],
  });

  const response = {
    success: failed.length === 0,
    message:
      failed.length > 0
        ? `${failed.length} test(s) failed in Edge Runtime`
        : `All ${all.length} tests passed in Edge Runtime`,
    runtime: "edge",
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
