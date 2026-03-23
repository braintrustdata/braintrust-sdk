import { expect, test } from "vitest";
import { assertAnthropicTraceContract } from "../../helpers/anthropic-trace-contract";
import {
  formatJsonFileSnapshot,
  resolveFileSnapshotPath,
} from "../../helpers/file-snapshot";
import {
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { E2E_TAGS } from "../../helpers/tags";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const TIMEOUT_MS = 90_000;
const sharedScenarioTestUrl = new URL(
  "../wrap-anthropic-message-traces/scenario.test.ts",
  import.meta.url,
).href;
const sharedSpanSnapshotPath = resolveFileSnapshotPath(
  sharedScenarioTestUrl,
  "span-events.json",
);
const sharedPayloadSnapshotPath = resolveFileSnapshotPath(
  sharedScenarioTestUrl,
  "log-payloads.json",
);

test(
  "anthropic auto-instrumentation via node hook matches the shared wrapper trace contract",
  {
    tags: [E2E_TAGS.externalApi],
    timeout: TIMEOUT_MS,
  },
  async () => {
    await withScenarioHarness(async ({ events, runNodeScenarioDir }) => {
      await runNodeScenarioDir({
        nodeArgs: ["--import", "braintrust/hook.mjs"],
        scenarioDir,
        timeoutMs: TIMEOUT_MS,
      });

      const contract = assertAnthropicTraceContract({
        capturedEvents: events(),
        rootName: "anthropic-wrapper-root",
        scenarioName: "wrap-anthropic-message-traces",
      });

      await expect(
        formatJsonFileSnapshot(contract.spanSummary),
      ).toMatchFileSnapshot(sharedSpanSnapshotPath);
      await expect(
        formatJsonFileSnapshot(contract.payloadSummary),
      ).toMatchFileSnapshot(sharedPayloadSnapshotPath);
    });
  },
);
