import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scenarioDir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3999;

// Resolve next CLI relative to the scenario's own node_modules, since the
// scenario runs in a copy of this directory without .bin symlinks.
const nextBin = new URL("./node_modules/next/dist/bin/next", import.meta.url)
  .pathname;

// Run Next.js build (Turbopack is the default bundler in Next.js 16)
const buildResult = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: scenarioDir,
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});

if (buildResult.status !== 0) {
  throw new Error(`next build failed with exit code ${buildResult.status}`);
}

// Start the Next.js server
const server = spawn(
  process.execPath,
  [nextBin, "start", "--port", String(PORT)],
  {
    cwd: scenarioDir,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  },
);

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { status } = await httpGet(`http://localhost:${PORT}/api/test`);
      if (status === 200) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Next.js server did not become ready within ${timeoutMs}ms`);
}

// Top-level await is not supported in CJS output, so use an explicit async
// function and propagate failures via process.exit.
async function main() {
  try {
    await waitForServer();

    const { body } = await httpGet(`http://localhost:${PORT}/api/test`);
    const data = JSON.parse(body) as { instrumented: boolean };

    if (!data.instrumented) {
      throw new Error(
        "OpenAI tracing channel did not fire — Turbopack instrumentation is not working",
      );
    }

    console.log(
      "✓ OpenAI tracing channel fired at runtime — Turbopack instrumentation is active",
    );
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
