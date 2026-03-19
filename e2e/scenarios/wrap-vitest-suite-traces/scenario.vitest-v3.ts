import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { resolveScenarioDir } from "../../helpers/scenario-harness";
import {
  getTestRunId,
  runMain,
  runNodeSubprocess,
} from "../../helpers/scenario-runtime";

const require = createRequire(import.meta.url);
const scenarioDir = resolveScenarioDir(import.meta.url);

// Resolve the vitest.mjs bin by finding the package root via the main entry.
function findVitestBin(packageName: string): string {
  const entryPath = require.resolve(packageName);
  let dir = path.dirname(entryPath);
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "vitest.mjs");
    if (existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find vitest.mjs for ${packageName}`);
}

const vitestCliPath = findVitestBin("vitest-v3");

async function main() {
  const testRunId = getTestRunId();

  await runNodeSubprocess({
    args: [vitestCliPath, "run", "--config", "vitest.runner-v3.config.mts"],
    cwd: scenarioDir,
    env: {
      BRAINTRUST_E2E_RUN_ID: testRunId,
    },
    timeoutMs: 60_000,
  });
}

runMain(main);
