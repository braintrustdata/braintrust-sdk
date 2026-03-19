import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { assertOpenRouterTraceContract } from "../../helpers/openrouter-trace-contract";
import {
  isCanaryMode,
  prepareScenarioDir,
  readInstalledPackageVersion,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const openrouterSdkVersion = await readInstalledPackageVersion(
  scenarioDir,
  "@openrouter/sdk",
);
const TIMEOUT_MS = 90_000;
const sharedSpanSnapshotPath = fileURLToPath(
  new URL("./span-events.json", import.meta.url),
);

test(
  "wrap-openrouter-traces captures wrapper instrumentation",
  async () => {
    await withScenarioHarness(async ({ events, runScenarioDir }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

      const contract = assertOpenRouterTraceContract({
        capturedEvents: events(),
        rootName: "openrouter-wrapper-root",
        scenarioName: "openrouter-traces",
        snapshotRootName: "openrouter-root",
        version: openrouterSdkVersion,
      });

      if (!isCanaryMode()) {
        await expect(
          `${JSON.stringify(contract.spanSummary, null, 2)}\n`,
        ).toMatchFileSnapshot(sharedSpanSnapshotPath);
      }
    });
  },
  TIMEOUT_MS,
);

test(
  "openrouter auto-instrumentation via node hook collects traces without manual wrapping",
  async () => {
    await withScenarioHarness(async ({ events, runNodeScenarioDir }) => {
      await runNodeScenarioDir({
        nodeArgs: ["--import", "braintrust/hook.mjs"],
        scenarioDir,
        timeoutMs: TIMEOUT_MS,
      });

      const contract = assertOpenRouterTraceContract({
        capturedEvents: events(),
        rootName: "openrouter-auto-hook-root",
        scenarioName: "openrouter-traces",
        snapshotRootName: "openrouter-root",
        version: openrouterSdkVersion,
      });

      if (!isCanaryMode()) {
        await expect(
          `${JSON.stringify(contract.spanSummary, null, 2)}\n`,
        ).toMatchFileSnapshot(sharedSpanSnapshotPath);
      }
    });
  },
  TIMEOUT_MS,
);
