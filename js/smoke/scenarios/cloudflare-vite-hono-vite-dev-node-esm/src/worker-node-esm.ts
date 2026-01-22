import { Hono } from "hono";
import { runImportVerificationTests, type TestResult } from "../../../shared";

// Explicitly import Node.js ESM build
import * as braintrustNode from "braintrust/node";

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
    // Vite bundler should resolve Node.js ESM build when importing from "braintrust/node"
    // Note: This worker will not actually run via vite dev due to nunjucks bundling error,
    // but we test import resolution to verify the export path works correctly.
    const importResults = await runImportVerificationTests(braintrustNode, {
      expectedBuild: "node",
      expectedFormat: "esm",
    });

    const failures = importResults.filter((r) => r.status === "fail");

    return {
      success: failures.length === 0,
      message:
        failures.length === 0
          ? "Node.js ESM import resolution test passed"
          : `${failures.length} test(s) failed`,
      totalTests: importResults.length,
      passedTests: importResults.length - failures.length,
      failedTests: failures.length,
      results: importResults,
      failures: failures.length > 0 ? failures : undefined,
    };
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
