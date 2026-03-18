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

test("anthropic auto-instrumentation via node hook collects the shared anthropic trace contract", async () => {
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

      if (!isCanaryMode()) {
        expect(contract.spanSummary).toMatchSnapshot("span-events");
        expect(contract.payloadSummary).toMatchSnapshot("log-payloads");
      }
    },
  );
});
