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

test("google genai auto-instrumentation via node hook collects the shared google genai trace contract", async () => {
  await withScenarioHarness(
    async ({ events, payloads, runNodeScenarioDir }) => {
      await runNodeScenarioDir({
        nodeArgs: ["--import", "braintrust/hook.mjs"],
        scenarioDir,
        timeoutMs: TIMEOUT_MS,
      });

      const contract = assertGoogleGenAITraceContract({
        capturedEvents: events(),
        payloads: payloads(),
        rootName: "google-genai-auto-hook-root",
        scenarioName: "google-genai-auto-instrumentation-node-hook",
      });

      if (!isCanaryMode()) {
        expect(contract.spanSummary).toMatchSnapshot("span-events");
        expect(contract.payloadSummary).toMatchSnapshot("log-payloads");
      }
    },
  );
});
