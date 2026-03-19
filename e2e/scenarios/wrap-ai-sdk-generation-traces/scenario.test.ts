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
import { E2E_TAGS } from "../../helpers/tags";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const wrapAISDKScenarios = await getWrapAISDKScenarios(scenarioDir);

for (const scenario of wrapAISDKScenarios) {
  test(
    `wrap-ai-sdk-generation-traces captures wrapper and child model spans ('${scenario.dependencyName}')`,
    {
      tags: [E2E_TAGS.externalApi],
      timeout: AI_SDK_SCENARIO_TIMEOUT_MS,
    },
    async () => {
      await withScenarioHarness(
        async ({ events, payloads, runScenarioDir }) => {
          await runScenarioDir({
            entry: scenario.entry,
            scenarioDir,
            timeoutMs: AI_SDK_SCENARIO_TIMEOUT_MS,
          });

          const contract = assertAISDKTraceContract({
            agentSpanName: scenario.agentSpanName,
            capturedEvents: events(),
            payloads: payloads(),
            rootName: "ai-sdk-wrapper-root",
            scenarioName: "wrap-ai-sdk-generation-traces",
            supportsGenerateObject: scenario.supportsGenerateObject,
            supportsStreamObject: scenario.supportsStreamObject,
            supportsToolExecution: scenario.supportsToolExecution,
            version: scenario.version,
          });

          expect(contract.spanSummary).toMatchSnapshot("span-events");
          expect(contract.payloadSummary).toMatchSnapshot("log-payloads");
        },
      );
    },
  );
}
