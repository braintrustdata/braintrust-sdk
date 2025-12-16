#!/usr/bin/env node
/**
 * Test script for Next.js API routes
 * Calls both Edge Runtime and Node.js Runtime test endpoints
 */

import { spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const EDGE_URL = `${BASE_URL}/api/smoke-test/edge`;
const NODE_URL = `${BASE_URL}/api/smoke-test/node`;
const MAX_STARTUP_TIME = 60000; // 60 seconds
const POLL_INTERVAL = 1000; // 1 second

let devServer = null;

/**
 * Start the Next.js dev server
 */
function startDevServer() {
  console.log("Starting Next.js dev server...\n");

  devServer = spawn("npm", ["run", "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  devServer.stdout.on("data", (data) => {
    const output = data.toString();
    process.stdout.write(output);
    if (output.includes("Ready") || output.includes("started server")) {
      console.log("✓ Dev server ready\n");
    }
  });

  devServer.stderr.on("data", (data) => {
    process.stderr.write(data.toString());
  });

  devServer.on("error", (error) => {
    console.error("Failed to start dev server:", error);
  });

  return devServer;
}

/**
 * Wait for server to be ready
 */
async function waitForServer(maxTime = MAX_STARTUP_TIME) {
  const startTime = Date.now();

  console.log("Waiting for server to be ready...");

  while (Date.now() - startTime < maxTime) {
    try {
      const response = await fetch(`${BASE_URL}/`, { method: "HEAD" });
      if (response.ok || response.status === 404) {
        console.log("✓ Server is responding\n");
        await setTimeout(2000); // Buffer time
        return true;
      }
    } catch (error) {
      // Server not ready yet
    }

    await sleep(POLL_INTERVAL);
    process.stdout.write(".");
  }

  console.error("\n✗ Server failed to start within timeout\n");
  return false;
}

/**
 * Test an API endpoint
 */
async function testEndpoint(url, name) {
  console.log(`Testing ${name}...`);
  console.log(`  URL: ${url}`);

  try {
    const response = await fetch(url);
    const result = await response.json();

    console.log(`  Status: ${response.status}`);
    console.log(`  Runtime: ${result.runtime}`);
    console.log(`  Message: ${result.message}`);

    if (result.totalTests !== undefined) {
      console.log(`  Tests: ${result.passedTests}/${result.totalTests} passed`);
    }

    if (result.failures && result.failures.length > 0) {
      console.log(`  Failures:`);
      for (const failure of result.failures) {
        console.log(`    - ${failure.testName}: ${failure.error}`);
      }
    }

    console.log(`  Result: ${result.success ? "✅ PASS" : "❌ FAIL"}`);
    console.log();

    return {
      success: result.success,
      status: response.status,
      result,
    };
  } catch (error) {
    console.error(`  Error: ${error.message}`);
    console.log(`  Result: ❌ FAIL`);
    console.log();

    return {
      success: false,
      status: null,
      error: error.message,
    };
  }
}

/**
 * Cleanup and exit
 */
function cleanup(exitCode = 0) {
  if (devServer) {
    console.log("\nStopping dev server...");
    devServer.kill("SIGTERM");

    setTimeout(() => {
      if (devServer && !devServer.killed) {
        devServer.kill("SIGKILL");
      }
    }, 5000);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 1000);
}

/**
 * Main execution
 */
async function main() {
  console.log("Next.js API Routes Test");
  console.log("=".repeat(60));
  console.log();

  // Handle cleanup on exit
  process.on("SIGINT", () => cleanup(1));
  process.on("SIGTERM", () => cleanup(1));

  try {
    // Start dev server
    startDevServer();

    // Wait for server to be ready
    const serverReady = await waitForServer();
    if (!serverReady) {
      console.error("✗ Server startup failed\n");
      cleanup(1);
      return;
    }

    console.log("=".repeat(60));
    console.log("Running Tests");
    console.log("=".repeat(60));
    console.log();

    // Test Edge Runtime
    const edgeResult = await testEndpoint(EDGE_URL, "Edge Runtime");

    // Test Node.js Runtime
    const nodeResult = await testEndpoint(NODE_URL, "Node.js Runtime");

    // Summary
    console.log("=".repeat(60));
    console.log("Summary");
    console.log("=".repeat(60));
    console.log();

    const allPassed = edgeResult.success && nodeResult.success;

    console.log(
      `Edge Runtime:   ${edgeResult.success ? "✅ PASS" : "❌ FAIL"}`,
    );
    console.log(
      `Node.js Runtime: ${nodeResult.success ? "✅ PASS" : "❌ FAIL"}`,
    );
    console.log();

    if (allPassed) {
      console.log("✅ All tests passed!");
      cleanup(0);
    } else {
      console.log("❌ Some tests failed");
      cleanup(1);
    }
  } catch (error) {
    console.error("\n❌ Unexpected error:");
    console.error(error);
    cleanup(1);
  }
}

// Run
main();
