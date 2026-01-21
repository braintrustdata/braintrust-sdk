#!/usr/bin/env node
/**
 * Test for Vite dev server compatibility with braintrust/node import
 *
 * This test verifies if Vite can pre-bundle braintrust/node (Node.js ESM build)
 * without hitting the Nunjucks bundling error. The Node.js build includes Nunjucks
 * (used for prompt templating) which doesn't work in Vite's ESM bundler due to
 * its use of Object.setPrototypeOf with undefined values.
 *
 * Error: TypeError: Object prototype may only be an Object or null: undefined
 *   at _inheritsLoose (node_modules/nunjucks/src/object.js:8:77)
 *
 * This test uses the worker-node-esm.ts which explicitly imports "braintrust/node".
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  displayTestResults,
  hasFailures,
} from "../../../shared/dist/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scenarioDir = join(__dirname, "..");
const viteConfig = join(scenarioDir, "vite-node-esm.config.ts");

const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testViteDevServerWithNodeEsm() {
  // Clear Vite cache to force fresh dependency pre-bundling
  try {
    rmSync(join(scenarioDir, "node_modules/.vite"), {
      recursive: true,
      force: true,
    });
  } catch {}

  // Try to start Vite dev server with node-esm config
  const vite = spawn("npx", ["vite", "--config", viteConfig], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    cwd: scenarioDir,
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
          "Vite dev server fails to start due to Nunjucks incompatibility when bundling braintrust/node",
        error:
          "TypeError: Object prototype may only be an Object or null: undefined",
        details:
          "Vite's dependency pre-bundler cannot handle Nunjucks' use of Object.setPrototypeOf when pre-bundling braintrust/node",
        recommendation:
          "Use 'braintrust/browser' import or configure Vite to exclude Nunjucks from optimization",
      };
    }

    // Check for successful startup
    if (combined.includes("Local:") || combined.includes("http://localhost")) {
      resolved = true;
      testResult = {
        success: true,
        message:
          "Vite dev server started successfully with braintrust/node import",
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
      name: "viteDevServerNodeEsmStartup",
      message:
        "Vite dev server started successfully with braintrust/node import",
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
      name: "viteDevServerNodeEsmStartup",
      message:
        "Expected failure: Nunjucks incompatibility with Vite bundler when using braintrust/node. " +
        "Root cause: Nunjucks uses Object.setPrototypeOf in ways incompatible with Vite's ESM bundler. " +
        "The Node.js ESM build includes Nunjucks, which causes this error during Vite's dependency pre-bundling. " +
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
      name: "viteDevServerNodeEsmStartup",
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
    scenarioName: "Vite Dev Server - braintrust/node Import Test",
    results,
  });

  // Check for failures (hasFailures excludes xfail)
  if (hasFailures(results)) {
    process.exit(1);
  }
}

testViteDevServerWithNodeEsm().catch((error) => {
  console.error(error);
  process.exit(1);
});
