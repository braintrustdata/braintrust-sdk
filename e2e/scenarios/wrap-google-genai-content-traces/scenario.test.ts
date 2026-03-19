import { expect, test } from "vitest";
import { assertGoogleGenAITraceContract } from "../../helpers/google-genai-trace-contract";
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
  "wrap-google-genai-content-traces captures generate, attachment, stream, early-return, and tool spans",
  {
    tags: [E2E_TAGS.externalApi],
    timeout: TIMEOUT_MS,
  },
  async () => {
    await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

      const contract = assertGoogleGenAITraceContract({
        capturedEvents: events(),
        payloads: payloads(),
        rootName: "google-genai-wrapper-root",
        scenarioName: "wrap-google-genai-content-traces",
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
