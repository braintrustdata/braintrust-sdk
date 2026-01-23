/**
 * Shared test utilities for Braintrust smoke tests
 *
 * This package provides reusable test suites and helpers that can be used
 * across different runtime environments (Node.js, Deno, Cloudflare Workers, etc.)
 */

// Export types
export type {
  LoggerSpan,
  LoggerInstance,
  BackgroundLogger,
  TestingExports,
  TestResult,
} from "./helpers/types";

// Export register helpers (new pattern)
export {
  register,
  runTests,
  validateCoverage,
  expectFailure,
  getRegisteredTests,
  clearRegistry,
} from "./helpers/register";
export type {
  TestFn,
  TestContext,
  RunTestsOptions,
  TestRunResults,
  ErrorPredicate,
} from "./helpers/register";

// Export assertions
export {
  AssertionError,
  assert,
  assertEqual,
  assertLength,
  assertNotEmpty,
  assertSpanEvent,
  assertSpanCaptured,
  assertDefined,
  assertType,
  assertHasProperty,
} from "./helpers/assertions";

// Export display utilities
export type { DisplayTestResultsOptions } from "./helpers/display";
export {
  displayTestResults,
  hasFailures,
  getFailureCount,
  getTestStats,
} from "./helpers/display";

// Export test suites - basic logging
export {
  testBasicSpanLogging,
  testMultipleSpans,
  testDirectLogging,
  testJSONAttachment,
  testAsyncLocalStorageTraced,
  testNestedTraced,
  testCurrentSpan,
} from "./suites/basic-logging";

// Export test suites - import verification
export type { BraintrustModule } from "./suites/import-verification";
export {
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
} from "./suites/import-verification";

// Export test suites - prompt templating
export {
  testMustacheTemplate,
  testNunjucksTemplate,
} from "./suites/prompt-templating";

// Export test suites - eval smoke
export { testEvalSmoke } from "./suites/eval-smoke";
