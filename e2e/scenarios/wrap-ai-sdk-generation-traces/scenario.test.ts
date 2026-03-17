import { beforeAll, expect, test } from "vitest";
import {
  AI_SDK_SCENARIO_TIMEOUT_MS,
  WRAP_AI_SDK_SCENARIOS,
} from "../../helpers/ai-sdk";
import { assertAISDKTraceContract } from "../../helpers/ai-sdk-trace-contract";
import {
  installScenarioDependencies,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";

const scenarioDir = resolveScenarioDir(import.meta.url);

beforeAll(async () => {
  await installScenarioDependencies({ scenarioDir });
});

test.each(WRAP_AI_SDK_SCENARIOS)(
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
);
