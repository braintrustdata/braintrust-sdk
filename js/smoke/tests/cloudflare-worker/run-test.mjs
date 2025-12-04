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

async function runTest() {
  killPort(PORT);

  const wrangler = spawn("npx", ["wrangler", "dev", "--port", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  let output = "";
  wrangler.stdout.on("data", (d) => (output += d));
  wrangler.stderr.on("data", (d) => (output += d));

  let exitCode = 1;

  try {
    if (!(await waitForServer())) {
      console.error("Server failed to start:\n", output);
      return 1;
    }

    const response = await fetch(`http://localhost:${PORT}/test`);
    const result = await response.json();

    console.log(JSON.stringify(result, null, 2));
    exitCode = result.success ? 0 : 1;
  } catch (error) {
    console.error("Error:", error.message, "\n", output);
    exitCode = 1;
  }

  wrangler.kill("SIGTERM");
  await sleep(100);
  killPort(PORT);

  return exitCode;
}

runTest().then((code) => process.exit(code));
