import { expect, test } from "vitest";
import {
  formatJsonFileSnapshot,
  resolveFileSnapshotPath,
} from "../../helpers/file-snapshot";
import {
  getOpenAIAutoHookScenarios,
  OPENAI_SCENARIO_TIMEOUT_MS,
} from "../../helpers/openai";
import { assertOpenAITraceContract } from "../../helpers/openai-trace-contract";
import {
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { E2E_TAGS } from "../../helpers/tags";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const openaiAutoHookScenarios = await getOpenAIAutoHookScenarios(scenarioDir);

for (const scenario of openaiAutoHookScenarios) {
  test(
    `openai auto-instrumentation via node hook collects traces without manual wrapping (openai ${scenario.version})`,
    {
      tags: [E2E_TAGS.externalApi],
      timeout: OPENAI_SCENARIO_TIMEOUT_MS,
    },
    async () => {
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

        await expect(
          formatJsonFileSnapshot(contract.spanSummary),
        ).toMatchFileSnapshot(
          resolveFileSnapshotPath(
            import.meta.url,
            `${scenario.dependencyName}.span-events.json`,
          ),
        );
      });
    },
  );
}
