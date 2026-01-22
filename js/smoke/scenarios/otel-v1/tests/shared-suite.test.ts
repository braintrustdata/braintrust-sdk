/**
 * Runs shared test suites to verify SDK exports and basic functionality
 */

import {
  runTests,
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
} from "../../../shared/dist/index.js";

async function runSharedTestSuites() {
  const braintrust = await import("braintrust");

  const { failed } = await runTests({
    name: "otel-v1",
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
    ],
  });

  if (failed.length > 0) {
    throw new Error(`${failed.length} test(s) failed`);
  }
}

runSharedTestSuites()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test execution failed:", error.message);
    process.exit(1);
  });
