import { expect, test } from "vitest";
import { assertAnthropicTraceContract } from "../../helpers/anthropic-trace-contract";
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

test("wrap-anthropic-message-traces captures create, stream, beta, attachment, and tool spans", async () => {
  await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
    await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

    const contract = assertAnthropicTraceContract({
      capturedEvents: events(),
      payloads: payloads(),
      rootName: "anthropic-wrapper-root",
      scenarioName: "wrap-anthropic-message-traces",
    });

    if (!isCanaryMode()) {
      expect(contract.spanSummary).toMatchSnapshot("span-events");
      expect(contract.payloadSummary).toMatchSnapshot("log-payloads");
    }
  });
});
