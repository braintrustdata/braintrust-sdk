import { spawn, execSync } from "node:child_process";

const PORT = 8799;
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

async function runWranglerTest({ config, label }) {
  killPort(PORT);

  const wrangler = spawn(
    "npx",
    ["wrangler", "dev", "--config", config, "--port", String(PORT)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
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
      console.error(`[${label}] Server failed to start:\n`, output);
      await killWrangler();
      return 1;
    }

    const response = await fetch(`http://localhost:${PORT}/test`);
    const result = await response.json();

    console.log(`\n=== ${label} ===\n`);
    console.log(JSON.stringify(result, null, 2));
    exitCode = result.success ? 0 : 1;
  } catch (error) {
    console.error(`[${label}] Error:`, error.message, "\n", output);
    exitCode = 1;
  }

  await killWrangler();
  return exitCode;
}

async function main() {
  const a = await runWranglerTest({
    config: "wrangler.node.toml",
    label: "nodejs_compat_v2 + braintrust",
  });
  if (a !== 0) process.exit(a);

  const b = await runWranglerTest({
    config: "wrangler.browser.toml",
    label: "no compatibility_flags + braintrust/browser",
  });
  process.exit(b);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
