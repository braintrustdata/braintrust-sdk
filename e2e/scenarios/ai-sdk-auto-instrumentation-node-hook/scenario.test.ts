import { beforeAll, test } from "vitest";
import {
  AI_SDK_AUTO_HOOK_SCENARIOS,
  AI_SDK_SCENARIO_TIMEOUT_MS,
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

for (const scenario of AI_SDK_AUTO_HOOK_SCENARIOS) {
  test(
    `ai sdk auto-instrumentation via node hook collects ${scenario.agentSpanName} traces without manual wrapping (ai ${scenario.version})`,
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

          expect(contract.spanSummary).toMatchSnapshot("span-events");
          expect(contract.payloadSummary).toMatchSnapshot("log-payloads");
        },
      );
    },
    AI_SDK_SCENARIO_TIMEOUT_MS,
  );
}
