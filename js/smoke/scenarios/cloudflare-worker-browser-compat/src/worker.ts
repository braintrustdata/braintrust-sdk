import * as braintrust from "braintrust";
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

interface Env {}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/test") {
      const { all, passed, failed, xfail } = await runTests({
        name: "cloudflare-worker-browser-compat",
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
            (e: { message: string }) =>
              e.message.includes("requires @braintrust/template-nunjucks"),
            "Nunjucks not supported in browser build",
          ),
        ],
      });

      const response = {
        success: failed.length === 0,
        message:
          failed.length > 0
            ? `${failed.length} test(s) failed`
            : "All shared test suites passed",
        totalTests: all.length,
        passedTests: passed.length,
        failedTests: failed.length,
        xfailTests: xfail.length,
        results: all.map((r) => ({
          ...r,
          error: r.error
            ? { message: r.error.message, stack: r.error.stack }
            : undefined,
        })),
        failures: failed.map((r) => ({
          ...r,
          error: r.error
            ? { message: r.error.message, stack: r.error.stack }
            : undefined,
        })),
      };

      return new Response(JSON.stringify(response, null, 2), {
        headers: { "Content-Type": "application/json" },
        status: response.success ? 200 : 500,
      });
    }

    return new Response(
      `Braintrust Cloudflare Worker Smoke Test (Browser + nodejs_compat_v2)

GET /test - Run shared test suites`,
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};
