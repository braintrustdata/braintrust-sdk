import { expect, test } from "vitest";
import {
  getWrapOpenAIScenarios,
  OPENAI_SCENARIO_TIMEOUT_MS,
} from "../../helpers/openai";
import { assertOpenAITraceContract } from "../../helpers/openai-trace-contract";
import {
  isCanaryMode,
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { E2E_TAGS } from "../../helpers/tags";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const wrapOpenAIScenarios = await getWrapOpenAIScenarios(scenarioDir);

for (const scenario of wrapOpenAIScenarios) {
  test(
    `wrap-openai-conversation-traces logs wrapped endpoint traces (openai ${scenario.version})`,
    {
      tags: [E2E_TAGS.externalApi],
      timeout: OPENAI_SCENARIO_TIMEOUT_MS,
    },
    async () => {
      await withScenarioHarness(async ({ events, runScenarioDir }) => {
        await runScenarioDir({
          entry: scenario.entry,
          scenarioDir,
          timeoutMs: OPENAI_SCENARIO_TIMEOUT_MS,
        });

        const contract = assertOpenAITraceContract({
          capturedEvents: events(),
          rootName: "openai-wrapper-root",
          scenarioName: "wrap-openai-conversation-traces",
          version: scenario.version,
        });

        if (!isCanaryMode()) {
          expect(contract.spanSummary).toMatchSnapshot("span-events");
        }
      });
    },
  );
}
