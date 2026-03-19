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

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const wrapOpenAIScenarios = await getWrapOpenAIScenarios(scenarioDir);

test.each(
  wrapOpenAIScenarios.map(({ entry, version }) => [version, entry] as const),
)(
  "wrap-openai-conversation-traces logs wrapped endpoint traces (openai %s)",
  async (version, entry) => {
    await withScenarioHarness(async ({ events, runScenarioDir }) => {
      await runScenarioDir({
        entry,
        scenarioDir,
        timeoutMs: OPENAI_SCENARIO_TIMEOUT_MS,
      });

      const contract = assertOpenAITraceContract({
        capturedEvents: events(),
        rootName: "openai-wrapper-root",
        scenarioName: "wrap-openai-conversation-traces",
        version,
      });

      if (!isCanaryMode()) {
        expect(contract.spanSummary).toMatchSnapshot("span-events");
      }
    });
  },
  OPENAI_SCENARIO_TIMEOUT_MS,
);
