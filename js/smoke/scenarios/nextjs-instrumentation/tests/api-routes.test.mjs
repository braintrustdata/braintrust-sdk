#!/usr/bin/env node
/**
 * Test script for Next.js API routes
 * Calls both Edge Runtime and Node.js Runtime test endpoints
 */

import { spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";
import { displayTestResults } from "../../../shared/dist/index.mjs";

const PORT = 5555;
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
  devServer = spawn("npm", ["run", "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: { ...process.env, PORT: String(PORT) },
  });

  devServer.stdout.on("data", (data) => {
    process.stdout.write(data.toString());
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

  while (Date.now() - startTime < maxTime) {
    try {
      const response = await fetch(`${BASE_URL}/`, { method: "HEAD" });
      if (response.ok || response.status === 404) {
        await sleep(2000); // Buffer time
        return true;
      }
    } catch (error) {
      // Server not ready yet
    }
    await sleep(POLL_INTERVAL);
  }

  return false;
}

/**
 * Test an API endpoint
 */
async function testEndpoint(url, name) {
  try {
    const response = await fetch(url);
    const result = await response.json();

    // Display results using standardized format
    displayTestResults({
      scenarioName: `${name} Test Results`,
      results: result.results,
    });

    return {
      success: result.success,
      status: response.status,
      result,
    };
  } catch (error) {
    console.error(`Error testing ${name}:`, error.message);
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
  // Handle cleanup on exit
  process.on("SIGINT", () => cleanup(1));
  process.on("SIGTERM", () => cleanup(1));

  try {
    // Start dev server
    startDevServer();

    // Wait for server to be ready
    const serverReady = await waitForServer();
    if (!serverReady) {
      console.error("Server startup failed");
      cleanup(1);
      return;
    }

    // Test Edge Runtime
    const edgeResult = await testEndpoint(EDGE_URL, "Edge Runtime");

    // Test Node.js Runtime
    const nodeResult = await testEndpoint(NODE_URL, "Node.js Runtime");

    // Exit based on results
    const allPassed = edgeResult.success && nodeResult.success;
    cleanup(allPassed ? 0 : 1);
  } catch (error) {
    console.error("Unexpected error:", error);
    cleanup(1);
  }
}

// Run
main();
