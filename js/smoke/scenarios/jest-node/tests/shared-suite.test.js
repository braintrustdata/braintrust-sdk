const {
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
  testMustacheTemplate,
  testNunjucksTemplate,
} = require("../../../shared/dist/index.js");

const braintrust = require("braintrust");

test("shared test suites pass in Jest", async () => {
  const { failed } = await runTests({
    name: "jest-node",
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
      testMustacheTemplate,
      testNunjucksTemplate,
    ],
  });

  expect(failed).toHaveLength(0);
});
