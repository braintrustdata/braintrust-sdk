#!/usr/bin/env node
/**
 * Test for Vite dev server compatibility with Braintrust SDK
 *
 * This test verifies a known issue: When Vite tries to pre-bundle the Braintrust SDK,
 * it encounters Nunjucks (used for prompt templating) which doesn't work in Vite's
 * ESM bundler due to its use of Object.setPrototypeOf with undefined values.
 *
 * Error: TypeError: Object prototype may only be an Object or null: undefined
 *   at _inheritsLoose (node_modules/nunjucks/src/object.js:8:77)
 *
 * This is a known limitation when using the full Braintrust SDK in Vite dev mode.
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { displayTestResults } from "../../../shared/dist/index.mjs";

const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testViteDevServer() {
  console.log("Testing Vite dev server compatibility with Braintrust SDK...\n");

  // Clear Vite cache to force fresh dependency pre-bundling
  console.log("1. Clearing Vite cache...");
  try {
    rmSync("node_modules/.vite", { recursive: true, force: true });
    console.log("   ✓ Vite cache cleared\n");
  } catch (error) {
    console.log("   ℹ No cache to clear\n");
  }

  // Try to start Vite dev server
  console.log("2. Starting Vite dev server...");

  const vite = spawn("npx", ["vite"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  let output = "";
  let errorOutput = "";

  vite.stdout.on("data", (d) => (output += d.toString()));
  vite.stderr.on("data", (d) => (errorOutput += d.toString()));

  // Wait for either success or error
  let resolved = false;
  let testResult = null;

  const checkOutput = () => {
    const combined = output + errorOutput;

    // Check for the Nunjucks error
    if (combined.includes("Object prototype may only be an Object or null")) {
      resolved = true;
      testResult = {
        success: false,
        issue: "vite-nunjucks-incompatibility",
        message:
          "Vite dev server fails to start due to Nunjucks incompatibility",
        error:
          "TypeError: Object prototype may only be an Object or null: undefined",
        details:
          "Vite's dependency pre-bundler cannot handle Nunjucks' use of Object.setPrototypeOf",
        recommendation:
          "Use 'braintrust/browser' import or configure Vite to exclude Nunjucks from optimization",
      };
    }

    // Check for successful startup
    if (combined.includes("Local:") || combined.includes("http://localhost")) {
      resolved = true;
      testResult = {
        success: true,
        message: "Vite dev server started successfully",
      };
    }
  };

  // Monitor for 10 seconds
  for (let i = 0; i < MAX_RETRIES && !resolved; i++) {
    await sleep(RETRY_DELAY_MS);
    checkOutput();
  }

  // Kill the process
  try {
    vite.kill("SIGTERM");
    await sleep(500);
    if (vite.exitCode === null) {
      vite.kill("SIGKILL");
    }
  } catch {}

  // Final check
  if (!resolved) {
    checkOutput();
  }

  if (!testResult) {
    testResult = {
      success: false,
      issue: "timeout",
      message: "Vite dev server did not start or error within timeout",
      output: (output + errorOutput).slice(-500),
    };
  }

  // Convert to TestResult format and display
  const results = [];

  if (testResult.success) {
    results.push({
      status: "pass",
      name: "viteDevServerStartup",
      message: "Vite dev server started successfully",
    });
  } else if (testResult.issue === "vite-nunjucks-incompatibility") {
    // Extract error details
    const errorLines = (output + errorOutput)
      .split("\n")
      .filter(
        (line) =>
          line.includes("error") ||
          line.includes("Error") ||
          line.includes("at "),
      )
      .slice(0, 3);

    const errorStack = errorLines.join("\n");

    results.push({
      status: "xfail",
      name: "viteDevServerStartup",
      message:
        "Expected failure: Nunjucks incompatibility with Vite bundler. " +
        "Root cause: Nunjucks uses Object.setPrototypeOf in ways incompatible with Vite's ESM bundler. " +
        "Recommendation: Use 'braintrust/browser' import or exclude Nunjucks from Vite optimization",
      error: errorStack
        ? {
            message: testResult.error,
            stack: errorStack,
          }
        : undefined,
    });
  } else {
    results.push({
      status: "fail",
      name: "viteDevServerStartup",
      message: testResult.message,
      error: testResult.output
        ? {
            message: testResult.message,
            stack: testResult.output,
          }
        : { message: testResult.message },
    });
  }

  // Use standardized display
  displayTestResults({
    scenarioName: "Vite Dev Server Compatibility Test",
    results,
  });

  // Return the actual test status
  if (testResult.issue === "vite-nunjucks-incompatibility") {
    // Expected failure - return 1 but this is documented
    return 1;
  } else if (testResult.success) {
    return 0;
  } else {
    return 1;
  }
}

testViteDevServer().then((code) => process.exit(code));
