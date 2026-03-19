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
  "wrap-anthropic-message-traces captures create, stream, beta, attachment, and tool spans",
  {
    tags: [E2E_TAGS.externalApi],
    timeout: TIMEOUT_MS,
  },
  async () => {
    await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

      const contract = assertAnthropicTraceContract({
        capturedEvents: events(),
        payloads: payloads(),
        rootName: "anthropic-wrapper-root",
        scenarioName: "wrap-anthropic-message-traces",
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
    });
  },
);
