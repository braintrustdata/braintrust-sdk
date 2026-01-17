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

  // Print results
  console.log("\n" + "=".repeat(60));
  console.log("VITE DEV SERVER TEST RESULTS");
  console.log("=".repeat(60) + "\n");

  if (testResult.success) {
    console.log("✓ Status: PASS - Vite dev server started successfully");
    console.log("\n🎉 The Nunjucks issue may have been fixed!");
    console.log(
      "Consider updating documentation if this is consistently passing.\n",
    );
  } else if (testResult.issue === "vite-nunjucks-incompatibility") {
    console.log("✗ Status: FAIL - Known Nunjucks incompatibility\n");
    console.log("Actual error from Vite:");
    console.log("-".repeat(60));
    // Show the actual error output
    const errorLines = (output + errorOutput)
      .split("\n")
      .filter(
        (line) =>
          line.includes("error") ||
          line.includes("Error") ||
          line.includes("at "),
      )
      .slice(0, 15); // Show first 15 relevant lines
    console.log(errorLines.join("\n"));
    console.log("-".repeat(60));
    console.log(
      "\nRoot cause: Nunjucks uses Object.setPrototypeOf in ways that",
    );
    console.log("fail in Vite's ESM bundler during dependency pre-bundling.\n");
    console.log("Recommendation: Use 'braintrust/browser' import or configure");
    console.log("Vite to exclude Nunjucks from optimization.\n");
  } else {
    console.log("✗ Status: UNEXPECTED FAILURE");
    console.log("  Issue:", testResult.issue);
    console.log("  Message:", testResult.message);
    if (testResult.output) {
      console.log("\nOutput:");
      console.log("-".repeat(60));
      console.log(testResult.output);
      console.log("-".repeat(60));
    }
  }

  console.log("\n" + "=".repeat(60) + "\n");

  // Return the actual test status
  if (testResult.issue === "vite-nunjucks-incompatibility") {
    console.log("Test result: FAIL (Known issue - expected to fail)");
    console.log(
      "\n💡 This is a known limitation. Configure CI to allow this failure.",
    );
    return 1; // Actual failure
  } else if (testResult.success) {
    console.log("Test result: PASS (Vite dev server started successfully!)");
    console.log(
      "\n🎉 The Nunjucks issue may be fixed! Review and update documentation.",
    );
    return 0;
  } else {
    console.log("Test result: FAIL (Unexpected behavior)");
    return 1;
  }
}

testViteDevServer().then((code) => process.exit(code));
