import { spawn, execSync } from "node:child_process";

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

async function main() {
  console.log(
    "\n=== Cloudflare Worker Node No Compat Test (Expected Failure) ===\n",
  );
  console.log(
    "This test expects the worker to fail at startup because the Node.js entrypoint",
  );
  console.log(
    "requires nodejs_compat_v2 to access Node.js APIs in Cloudflare Workers.\n",
  );

  killPort(PORT);

  const wrangler = spawn("npx", ["wrangler", "dev", "--port", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  let wranglerOutput = "";
  wrangler.stdout.on("data", (data) => (wranglerOutput += data));
  wrangler.stderr.on("data", (data) => (wranglerOutput += data));

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

  try {
    const serverStartedSuccessfully = await waitForServer();

    if (!serverStartedSuccessfully) {
      console.log("✓ Test PASSED: Worker failed to start as expected");
      console.log("\nWrangler output (showing expected failure):");
      console.log(wranglerOutput.trim() || "(no output)");
      await killWrangler();
      process.exit(0);
    }

    console.error(
      "✗ Test FAILED: Worker started successfully, but it should have failed!",
    );
    console.error(
      "The Node.js entrypoint should not work without nodejs_compat_v2.",
    );
    await killWrangler();
    process.exit(1);
  } catch (error) {
    console.log("✓ Test PASSED: Worker failed as expected");
    console.log(`Error: ${error.message}`);
    await killWrangler();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
