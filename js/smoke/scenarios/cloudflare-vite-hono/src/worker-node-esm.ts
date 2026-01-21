import { Hono } from "hono";
import { runImportVerificationTests, type TestResult } from "../../../shared";

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
    // Test that explicitly importing "braintrust/node" resolves to Node.js ESM build
    const results: TestResult[] = [];

    // Verify the module was imported successfully
    if (!braintrustNode || typeof braintrustNode !== "object") {
      results.push({
        status: "fail",
        name: "nodeEsmImportResolution",
        message: "Failed to import braintrust/node module",
        error: {
          message: "braintrust/node import returned invalid value",
        },
      });
    } else {
      // Verify it's the Node.js build (not browser)
      const testing = braintrustNode._exportsForTestingOnly;
      if (testing && typeof testing === "object") {
        const iso = (testing as any).isomorph;
        if (iso && typeof iso === "object") {
          const buildType = iso.buildType;
          const buildDetails = iso.buildDetails || "";

          if (buildType === "node") {
            results.push({
              status: "pass",
              name: "nodeEsmImportResolution",
              message: `Successfully imported braintrust/node as Node.js ESM build (mjs format). ${buildDetails}`,
            });
          } else {
            results.push({
              status: "fail",
              name: "nodeEsmImportResolution",
              message: `Expected Node.js build but got ${buildType}`,
              error: {
                message: `Build type mismatch: expected node (mjs), got ${buildType}`,
              },
            });
          }
        } else {
          results.push({
            status: "fail",
            name: "nodeEsmImportResolution",
            message: "Could not determine build type from isomorph",
            error: {
              message: "isomorph object not available in testing exports",
            },
          });
        }
      } else {
        results.push({
          status: "fail",
          name: "nodeEsmImportResolution",
          message: "Could not access testing exports to verify build type",
          error: {
            message: "_exportsForTestingOnly not available",
          },
        });
      }

      // Verify core exports are available
      if (
        braintrustNode.initLogger &&
        typeof braintrustNode.initLogger === "function"
      ) {
        results.push({
          status: "pass",
          name: "nodeEsmImportFunctionality",
          message: "Core braintrust/node exports are available and functional",
        });
      } else {
        results.push({
          status: "fail",
          name: "nodeEsmImportFunctionality",
          message: "Core braintrust/node exports are missing or invalid",
          error: {
            message: "initLogger not found or not a function",
          },
        });
      }

      // Run import verification tests to ensure all exports are available
      const importResults = await runImportVerificationTests(braintrustNode, {
        checkBuildResolution: true,
        expectedBuild: "node",
        expectedFormat: "esm",
      });
      results.push(...importResults);

      // Note: Node.js build might not work in Cloudflare Workers due to Node.js-specific APIs
      // This is expected and acceptable - the test verifies the import path resolves correctly
      try {
        // Try to use the logger to see if it works in Cloudflare context
        const testLogger = braintrustNode.initLogger({
          project: "test",
          apiKey: "test-key",
        });
        if (testLogger) {
          results.push({
            status: "pass",
            name: "nodeEsmCloudflareCompatibility",
            message:
              "Node.js ESM build is compatible with Cloudflare Workers (Vite may have polyfilled/bundled Node.js APIs)",
          });
        }
      } catch (error) {
        // This is expected - Node.js build may use APIs not available in Cloudflare
        results.push({
          status: "xfail",
          name: "nodeEsmCloudflareCompatibility",
          message: `Expected limitation: Node.js ESM build may not be fully compatible with Cloudflare Workers. Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    const failures = results.filter((r) => r.status === "fail");

    return {
      success: failures.length === 0,
      message:
        failures.length === 0
          ? "Node.js ESM import test passed (with expected limitations)"
          : `${failures.length} test(s) failed`,
      totalTests: results.length,
      passedTests: results.length - failures.length,
      failedTests: failures.length,
      results,
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

GET /api/test - Test explicit Node.js ESM import (braintrust/node)

This worker tests importing the Node.js ESM build explicitly via "braintrust/node"
in a Cloudflare Workers environment.`),
);

app.get("/api/test", async (c) => {
  const result = await runNodeEsmImportTest();
  return c.json(result, result.success ? 200 : 500);
});

export default app;
