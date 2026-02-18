import { Hono } from "hono";
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
} from "../../../shared";

import * as braintrust from "braintrust";

const app = new Hono<{ Bindings: Env }>();

interface Env {}

app.get("/", (c) =>
  c.text(`Braintrust Cloudflare Vite + Hono Smoke Test

GET /api/ - Basic API endpoint
GET /api/test - Run shared test suites`),
);

app.get("/api/", (c) => c.json({ name: "Braintrust", framework: "Hono" }));

app.get("/api/test", async (c) => {
  const { all, passed, failed, xfail } = await runTests({
    name: "cloudflare-vite-hono-vite-dev",
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
      testBuildResolution("workerd"),
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
        ? `${failed.length} test(s) failed`
        : "All shared test suites passed in Vite + Hono environment",
    totalTests: all.length,
    passedTests: passed.length,
    failedTests: failed.length,
    xfailTests: xfail.length,
    results: all,
    failures: failed,
  };

  return c.json(response, response.success ? 200 : 500);
});

export default app;
