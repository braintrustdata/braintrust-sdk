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
  TestAdapters,
  TestResult,
} from "./helpers/types";

// Export test state helpers
export {
  setupTestEnvironment,
  cleanupTestEnvironment,
  withTestEnvironment,
} from "./helpers/test-state";
export type { SetupTestEnvironmentOptions } from "./helpers/test-state";

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

// Export test suites
export {
  testBasicSpanLogging,
  testMultipleSpans,
  testDirectLogging,
  runBasicLoggingTests,
} from "./suites/basic-logging";

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
  runImportVerificationTests,
} from "./suites/import-verification";

export type { PromptModule } from "./suites/prompt-templating";
export {
  testMustacheTemplate,
  testNunjucksTemplate,
  runPromptTemplatingTests,
} from "./suites/prompt-templating";

// Eval smoke test suite
export { runEvalSmokeTest } from "./suites/eval-smoke";
