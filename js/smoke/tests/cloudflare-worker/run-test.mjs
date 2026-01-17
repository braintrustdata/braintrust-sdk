import { spawn, execSync } from "node:child_process";
import { parseArgs } from "node:util";

const PORT = 8799;
const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ENTRYPOINT = {
  node: "braintrust",
  browser: "braintrust/browser",
};

const COMPAT = {
  enabled: "nodejs_compat_v2",
  disabled: "no nodejs_compat",
};

const VARIANTS = {
  "node-node-compat": {
    config: "wrangler.node.toml",
    entrypoint: ENTRYPOINT.node,
    nodejsCompat: true,
  },
  "browser-no-compat": {
    config: "wrangler.browser.toml",
    entrypoint: ENTRYPOINT.browser,
    nodejsCompat: false,
  },
  "browser-node-compat": {
    config: "wrangler.browser-node-compat.toml",
    entrypoint: ENTRYPOINT.browser,
    nodejsCompat: true,
  },
  "node-no-compat": {
    config: "wrangler.node-no-compat.toml",
    entrypoint: ENTRYPOINT.node,
    nodejsCompat: false,
  },
};

function shouldExpectStartupFailure(variant) {
  // Node entrypoint requires nodejs_compat to access Node.js APIs
  return variant.entrypoint === ENTRYPOINT.node && !variant.nodejsCompat;
}

function displayTestResults(testResult, testLabel) {
  console.log(`\n=== ${testLabel} ===\n`);

  // Display individual test results if available
  if (testResult.results && testResult.results.length > 0) {
    console.log(
      `Tests: ${testResult.passedTests}/${testResult.totalTests} passed\n`,
    );

    for (const result of testResult.results) {
      const status = result.success ? "✓" : "✗";
      const statusColor = result.success ? "\x1b[32m" : "\x1b[31m";
      const resetColor = "\x1b[0m";

      console.log(`${statusColor}${status}${resetColor} ${result.name}`);

      if (!result.success && result.error) {
        console.log(`  Error: ${result.error}`);
      }
    }
  } else {
    console.log(JSON.stringify(testResult, null, 2));
  }
}

const VARIANTS_BY_CONFIG = Object.fromEntries(
  Object.entries(VARIANTS).map(([id, v]) => [v.config, { id, ...v }]),
);

function labelForVariant(variant) {
  return `${variant.nodejsCompat ? COMPAT.enabled : COMPAT.disabled} + ${variant.entrypoint}`;
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

async function runVariant(variant) {
  const testLabel = labelForVariant(variant);
  const wranglerConfig = variant.config;
  const startupShouldFail = shouldExpectStartupFailure(variant);

  killPort(PORT);

  const wrangler = spawn(
    "npx",
    ["wrangler", "dev", "--config", wranglerConfig, "--port", String(PORT)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    },
  );

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
      if (startupShouldFail) {
        console.log(`\n=== ${testLabel} (expected startup failure) ===\n`);
        console.log(wranglerOutput.trim() || "(no output)");
        await killWrangler();
        return 0;
      }
      console.error(`[${testLabel}] Server failed to start:\n`, wranglerOutput);
      await killWrangler();
      return 1;
    }

    const testResponse = await fetch(`http://localhost:${PORT}/test`);
    const testResult = await testResponse.json();

    displayTestResults(testResult, testLabel);

    const exitCode = testResult.success ? 0 : 1;
    await killWrangler();
    return exitCode;
  } catch (error) {
    console.error(`[${testLabel}] Error:`, error.message, "\n", wranglerOutput);
    await killWrangler();
    return 1;
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: "string" },
      variant: { type: "string" },
    },
    allowPositionals: false,
  });

  const requestedConfig = values.config;
  const requestedVariantId = values.variant;

  // If a specific variant/config was requested, run only that one
  if (requestedConfig || requestedVariantId) {
    const variant = requestedVariantId
      ? VARIANTS[requestedVariantId]
      : VARIANTS_BY_CONFIG[requestedConfig];

    if (!variant) {
      const availableVariants = Object.keys(VARIANTS).sort().join(", ");
      throw new Error(
        `Unknown variant/config. Use --variant <${availableVariants}> or --config <wrangler.*.toml>.`,
      );
    }

    const exitCode = await runVariant(variant);
    process.exit(exitCode);
  }

  // Run default test suite (both node and browser variants)
  const defaultTestSuite = [
    VARIANTS["node-node-compat"],
    VARIANTS["browser-no-compat"],
  ];

  for (const variant of defaultTestSuite) {
    const exitCode = await runVariant(variant);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
