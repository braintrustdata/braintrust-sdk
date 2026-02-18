// @ts-nocheck
/**
 * Deno smoke test using shared test suites (browser build)
 */

import { assertEquals } from "@std/assert";
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
} from "@braintrust/smoke-test-shared";
import * as braintrust from "braintrust";

Deno.test("Run shared test suites (browser build)", async () => {
  const { failed } = await runTests({
    name: "deno-browser",
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
      testBuildResolution("node"), // not pulling in browser package
      testBasicSpanLogging,
      testMultipleSpans,
      testDirectLogging,
      testJSONAttachment,
      expectFailure(
        testAsyncLocalStorageTraced,
        (e: { message: string }) => e.message.includes("span_parents"),
        "No AsyncLocalStorage available",
      ),
      expectFailure(
        testNestedTraced,
        (e: { message: string }) => e.message.includes("span_parents"),
        "No AsyncLocalStorage available",
      ),
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

  assertEquals(failed.length, 0, "All tests should pass");
});
