#!/usr/bin/env node
/**
 * Test for Vite dev server compatibility with Braintrust SDK (browser build)
 *
 * This test verifies that Vite can successfully pre-bundle the browser build of Braintrust.
 * The browser build does NOT include Nunjucks, so it should start successfully.
 *
 * Note: The Node.js ESM build (braintrust/node) DOES include Nunjucks and will fail
 * with Vite's bundler - that is tested separately in node-esm-import.test.mjs
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import {
  displayTestResults,
  hasFailures,
} from "../../../shared/dist/index.mjs";

const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testViteDevServer() {
  // Clear Vite cache to force fresh dependency pre-bundling
  try {
    rmSync("node_modules/.vite", { recursive: true, force: true });
  } catch {}

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

    // Check for successful startup
    if (combined.includes("Local:") || combined.includes("http://localhost")) {
      resolved = true;
      testResult = {
        success: true,
        message: "Vite dev server started successfully with browser build",
      };
    }

    // Check for any errors (browser build should not have nunjucks errors)
    if (combined.includes("Object prototype may only be an Object or null")) {
      resolved = true;
      testResult = {
        success: false,
        issue: "unexpected-nunjucks-error",
        message:
          "Unexpected Nunjucks error - browser build should not include Nunjucks",
        error:
          "TypeError: Object prototype may only be an Object or null: undefined",
        details:
          "Browser build should not include Nunjucks. This indicates a bundling or export resolution issue.",
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
      message:
        "Vite dev server started successfully with browser build (no Nunjucks)",
    });
  } else if (testResult.issue === "unexpected-nunjucks-error") {
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
      status: "fail",
      name: "viteDevServerStartup",
      message:
        "Unexpected Nunjucks error with browser build. " +
        "Browser build should not include Nunjucks, indicating a bundling or export resolution issue.",
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
    scenarioName: "Vite Dev Server - Browser Build Test",
    results,
  });

  // Check for failures (hasFailures excludes xfail)
  if (hasFailures(results)) {
    return 1;
  }
  return 0;
}

testViteDevServer()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
