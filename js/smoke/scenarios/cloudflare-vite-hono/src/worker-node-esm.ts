import { Hono } from "hono";
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  runBasicLoggingTests,
  runEvalSmokeTest,
  runImportVerificationTests,
  testMustacheTemplate,
  testNunjucksTemplate,
  type TestResult,
} from "../../../shared";

// Explicitly import Node.js ESM build
import * as braintrustNode from "braintrust/node";
const { initLogger, _exportsForTestingOnly } = braintrustNode;

const app = new Hono<{ Bindings: Env }>();

interface Env {}

interface TestResponse {
  success: boolean;
  message: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  results?: TestResult[];
  failures?: TestResult[];
}

async function runNodeEsmImportTest(): Promise<TestResponse> {
  try {
    const adapters = await setupTestEnvironment({
      initLogger,
      testingExports: _exportsForTestingOnly,
      canUseFileSystem: false,
      canUseCLI: false,
      environment: "cloudflare-vite-hono-node-esm",
    });

    try {
      // Vite bundler should resolve Node.js ESM build when importing from "braintrust/node"
      const importResults = await runImportVerificationTests(braintrustNode, {
        checkBuildResolution: true,
        expectedBuild: "node",
        expectedFormat: "esm",
      });
      const functionalResults = await runBasicLoggingTests(adapters);
      const evalResult = await runEvalSmokeTest(adapters, braintrustNode);

      // Test Mustache template (should always work)
      const mustacheResult = await testMustacheTemplate({
        Prompt: braintrustNode.Prompt,
      });

      // Test Nunjucks template - should work in Node.js build
      const nunjucksResult = await testNunjucksTemplate({
        Prompt: braintrustNode.Prompt,
      });

      const results = [
        ...importResults,
        ...functionalResults,
        evalResult,
        mustacheResult,
        nunjucksResult,
      ];

      // Filter out expected failures when counting actual failures
      const failures = results.filter((r) => r.status === "fail");

      if (failures.length > 0) {
        return {
          success: false,
          message: `${failures.length} test(s) failed`,
          totalTests: results.length,
          passedTests: results.length - failures.length,
          failedTests: failures.length,
          results,
          failures,
        };
      }

      return {
        success: true,
        message:
          "All shared test suites passed in Vite + Hono environment (Node.js ESM build)",
        totalTests: results.length,
        passedTests: results.length,
        failedTests: 0,
        results,
      };
    } finally {
      await cleanupTestEnvironment(adapters);
    }
  } catch (error) {
    return {
      success: false,
      message: `Error during Node.js ESM import test: ${error instanceof Error ? error.message : String(error)}`,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
    };
  }
}

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
  const result = await runNodeEsmImportTest();
  return c.json(result, result.success ? 200 : 500);
});

export default app;
