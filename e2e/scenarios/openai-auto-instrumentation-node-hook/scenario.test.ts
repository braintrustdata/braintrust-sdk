import { expect, test } from "vitest";
import {
  getOpenAIAutoHookScenarios,
  OPENAI_SCENARIO_TIMEOUT_MS,
} from "../../helpers/openai";
import { assertOpenAITraceContract } from "../../helpers/openai-trace-contract";
import {
  isCanaryMode,
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const openaiAutoHookScenarios = await getOpenAIAutoHookScenarios(scenarioDir);

for (const scenario of openaiAutoHookScenarios) {
  test(`openai auto-instrumentation via node hook collects traces without manual wrapping (openai ${scenario.version})`, async () => {
    await withScenarioHarness(async ({ events, runNodeScenarioDir }) => {
      await runNodeScenarioDir({
        entry: scenario.entry,
        nodeArgs: ["--import", "braintrust/hook.mjs"],
        scenarioDir,
        timeoutMs: OPENAI_SCENARIO_TIMEOUT_MS,
      });

      const contract = assertOpenAITraceContract({
        capturedEvents: events(),
        rootName: "openai-auto-hook-root",
        scenarioName: "openai-auto-instrumentation-node-hook",
        version: scenario.version,
      });

      if (!isCanaryMode()) {
        expect(contract.spanSummary).toMatchSnapshot("span-events");
      }
    });
  });
}
