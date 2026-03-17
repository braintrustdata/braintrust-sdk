import { expect, test } from "vitest";
import {
  AI_SDK_SCENARIO_TIMEOUT_MS,
  getWrapAISDKScenarios,
} from "../../helpers/ai-sdk";
import { assertAISDKTraceContract } from "../../helpers/ai-sdk-trace-contract";
import {
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const wrapAISDKScenarios = await getWrapAISDKScenarios(scenarioDir);

test.each(wrapAISDKScenarios)(
  "wrap-ai-sdk-generation-traces captures wrapper and child model spans (ai $version)",
  async ({
    agentSpanName,
    entry,
    supportsGenerateObject,
    supportsStreamObject,
    supportsToolExecution,
    version,
  }) => {
    await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
      await runScenarioDir({
        entry,
        scenarioDir,
        timeoutMs: AI_SDK_SCENARIO_TIMEOUT_MS,
      });

      const contract = assertAISDKTraceContract({
        agentSpanName,
        capturedEvents: events(),
        payloads: payloads(),
        rootName: "ai-sdk-wrapper-root",
        scenarioName: "wrap-ai-sdk-generation-traces",
        supportsGenerateObject,
        supportsStreamObject,
        supportsToolExecution,
        version,
      });

      expect(contract.spanSummary).toMatchSnapshot("span-events");
      expect(contract.payloadSummary).toMatchSnapshot("log-payloads");
    });
  },
  AI_SDK_SCENARIO_TIMEOUT_MS,
);
