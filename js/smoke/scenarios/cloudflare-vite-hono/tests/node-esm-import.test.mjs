#!/usr/bin/env node
/**
 * Test that explicitly verifies importing the Node.js ESM version via "braintrust/node"
 * in Cloudflare Workers environment.
 *
 * This test ensures that when importing "braintrust/node" explicitly, it correctly
 * resolves to the Node.js ESM build (dist/index.mjs) rather than the browser build.
 *
 * Note: The Node.js build may not be fully compatible with Cloudflare Workers due to
 * Node.js-specific APIs, but this test verifies the import path resolution works correctly.
 */

import { spawn, execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  displayTestResults,
  hasFailures,
} from "../../../shared/dist/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scenarioDir = join(__dirname, "..");
const wranglerConfig = join(scenarioDir, "wrangler-node-esm.toml");

const PORT = 8802;
const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function killPort(port) {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: "ignore",
    });
  } catch {}
}

async function waitForServer() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return true;
    } catch {}
    await sleep(RETRY_DELAY_MS);
  }
  return false;
}

async function runTest() {
  killPort(PORT);

  const wrangler = spawn(
    "npx",
    ["wrangler", "dev", "--config", wranglerConfig, "--port", String(PORT)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      cwd: scenarioDir,
    },
  );

  let output = "";
  wrangler.stdout.on("data", (d) => (output += d));
  wrangler.stderr.on("data", (d) => (output += d));

  const killWrangler = () => {
    return new Promise((resolve) => {
      if (wrangler.exitCode !== null) {
        resolve();
        return;
      }
      wrangler.once("exit", resolve);
      wrangler.kill("SIGTERM");
      setTimeout(() => {
        if (wrangler.exitCode === null) {
          wrangler.kill("SIGKILL");
        }
      }, 1000);
    });
  };

  let exitCode = 1;

  try {
    if (!(await waitForServer())) {
      await killWrangler();
      return 1;
    }

    const response = await fetch(`http://localhost:${PORT}/api/test`);
    if (!response.ok) {
      await killWrangler();
      return 1;
    }

    const result = await response.json();

    if (result.results && result.results.length > 0) {
      displayTestResults({
        scenarioName: "Cloudflare Vite Hono - Node.js ESM Import Test",
        results: result.results,
      });
    }

    // For this test, we accept xfail results as passing since Node.js build
    // may have expected limitations in Cloudflare Workers
    const actualFailures =
      result.results?.filter((r) => r.status === "fail") || [];
    exitCode = actualFailures.length === 0 ? 0 : 1;
  } catch (error) {
    exitCode = 1;
  }

  await killWrangler();
  return exitCode;
}

runTest().then((code) => process.exit(code));
