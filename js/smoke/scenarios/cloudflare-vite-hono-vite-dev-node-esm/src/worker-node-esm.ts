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

import * as braintrust from "braintrust/node";

const app = new Hono<{ Bindings: Env }>();

interface Env {}

app.get("/", (c) =>
  c.text(`Braintrust Cloudflare Vite + Hono Smoke Test (Node.js ESM Build)

GET /api/ - Basic API endpoint
GET /api/test - Run shared test suites

This worker tests the Braintrust SDK (Node.js ESM build) in a Vite + Hono + Cloudflare Workers environment.
Explicitly imports "braintrust/node" to test Node.js ESM build resolution.`),
);

app.get("/api/", (c) =>
  c.json({ name: "Braintrust", framework: "Hono", build: "node-esm" }),
);

app.get("/api/test", async (c) => {
  const { all, passed, failed, xfail } = await runTests({
    name: "cloudflare-vite-hono-vite-dev-node-esm",
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
        (e) => e.message.includes("Disallowed in this environment"),
        "Cloudflare Workers blocks dynamic code generation (eval/Function)",
      ),
    ],
  });

  const response = {
    success: failed.length === 0,
    message:
      failed.length > 0
        ? `${failed.length} test(s) failed`
        : "All shared test suites passed in Vite + Hono environment (Node.js ESM build)",
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
