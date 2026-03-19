import { expect, test } from "vitest";
import { assertGoogleGenAITraceContract } from "../../helpers/google-genai-trace-contract";
import {
  isCanaryMode,
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const TIMEOUT_MS = 90_000;

test("wrap-google-genai-content-traces captures generate, attachment, stream, early-return, and tool spans", async () => {
  await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
    await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

    const contract = assertGoogleGenAITraceContract({
      capturedEvents: events(),
      payloads: payloads(),
      rootName: "google-genai-wrapper-root",
      scenarioName: "wrap-google-genai-content-traces",
    });

    if (!isCanaryMode()) {
      expect(contract.spanSummary).toMatchSnapshot("span-events");
      expect(contract.payloadSummary).toMatchSnapshot("log-payloads");
    }
  });
});
