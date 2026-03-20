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

test(
  "anthropic auto-instrumentation via node hook collects the shared anthropic trace contract",
  {
    tags: [E2E_TAGS.externalApi],
    timeout: TIMEOUT_MS,
  },
  async () => {
    await withScenarioHarness(
      async ({ events, payloads, runNodeScenarioDir }) => {
        await runNodeScenarioDir({
          nodeArgs: ["--import", "braintrust/hook.mjs"],
          scenarioDir,
          timeoutMs: TIMEOUT_MS,
        });

        const contract = assertAnthropicTraceContract({
          capturedEvents: events(),
          payloads: payloads(),
          rootName: "anthropic-auto-hook-root",
          scenarioName: "anthropic-auto-instrumentation-node-hook",
        });

        await expect(
          formatJsonFileSnapshot(contract.spanSummary),
        ).toMatchFileSnapshot(
          resolveFileSnapshotPath(import.meta.url, "span-events.json"),
        );
        await expect(
          formatJsonFileSnapshot(contract.payloadSummary),
        ).toMatchFileSnapshot(
          resolveFileSnapshotPath(import.meta.url, "log-payloads.json"),
        );
      },
    );
  },
);
