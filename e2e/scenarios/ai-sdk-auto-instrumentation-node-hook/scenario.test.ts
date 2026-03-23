import { test } from "vitest";
import {
  AI_SDK_SCENARIO_TIMEOUT_MS,
  getAISDKAutoHookScenarios,
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
const autoHookScenarios = await getAISDKAutoHookScenarios(scenarioDir);

for (const scenario of autoHookScenarios) {
  test(
    `ai sdk auto-instrumentation via node hook collects ${scenario.agentSpanName} traces without manual wrapping (ai ${scenario.version})`,
    {
      tags: [E2E_TAGS.externalApi],
      timeout: AI_SDK_SCENARIO_TIMEOUT_MS,
    },
    async () => {
      await withScenarioHarness(
        async ({ events, payloads, runNodeScenarioDir }) => {
          await runNodeScenarioDir({
            entry: scenario.entry,
            nodeArgs: ["--import", "braintrust/hook.mjs"],
            scenarioDir,
            timeoutMs: AI_SDK_SCENARIO_TIMEOUT_MS,
          });

          const contract = assertAISDKTraceContract({
            agentSpanName: scenario.agentSpanName,
            capturedEvents: events(),
            payloads: payloads(),
            rootName: "ai-sdk-auto-hook-root",
            scenarioName: "ai-sdk-auto-instrumentation-node-hook",
            supportsGenerateObject: scenario.supportsGenerateObject,
            supportsStreamObject: scenario.supportsStreamObject,
            supportsToolExecution: scenario.supportsToolExecution,
            version: scenario.version,
          });

          void contract;
        },
      );
    },
  );
}
