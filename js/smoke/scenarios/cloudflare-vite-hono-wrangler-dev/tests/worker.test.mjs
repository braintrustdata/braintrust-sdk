import { spawn, execSync } from "node:child_process";
import {
  displayTestResults,
  hasFailures,
} from "../../../shared/dist/index.mjs";

const PORT = 8800;
const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --config");
      out.config = v;
      i++;
      continue;
    }
    if (a === "--expect-start-fail") {
      out.expectStartFail = true;
      continue;
    }
  }
  return out;
}

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

async function runWranglerTest({ config, label, expectStartFail = false }) {
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
      if (expectStartFail) {
        console.log(`\n=== ${label} (expected startup failure) ===\n`);
        console.log(output.trim() ? output : "(no output)");
        await killWrangler();
        return 0;
      }
      console.error(`[${label}] Server failed to start:\n`, output);
      await killWrangler();
      return 1;
    }

    const response = await fetch(`http://localhost:${PORT}/api/test`);
    const result = await response.json();

    if (result.results && result.results.length > 0) {
      displayTestResults({
        scenarioName: "Cloudflare Vite Hono Test Results",
        results: result.results,
      });
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    exitCode = result.success ? 0 : 1;
  } catch (error) {
    console.error(`[${label}] Error:`, error.message, "\n", output);
    exitCode = 1;
  }

  await killWrangler();
  return exitCode;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.config) {
    const label =
      args.config === "wrangler.node.toml"
        ? "nodejs_compat_v2 + braintrust"
        : args.config === "wrangler.browser.toml"
          ? "no compatibility_flags + braintrust/browser"
          : args.config === "wrangler.browser-node-compat.toml"
            ? "nodejs_compat_v2 + braintrust/browser"
            : args.config === "wrangler.node-no-compat.toml"
              ? "no compatibility_flags + braintrust"
              : args.config;
    const code = await runWranglerTest({
      config: args.config,
      label,
      expectStartFail: !!args.expectStartFail,
    });
    process.exit(code);
  }

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
