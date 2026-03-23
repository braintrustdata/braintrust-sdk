import { expect, test } from "vitest";
import {
  assertClaudeAgentSDKTraceContract,
  resolveClaudeAgentSDKSpanSnapshotPath,
} from "../../helpers/claude-agent-sdk-trace-contract";
import {
  CLAUDE_AGENT_SDK_SCENARIO_TIMEOUT_MS,
  getClaudeAgentSDKAutoHookScenarios,
} from "../../helpers/claude-agent-sdk";
import { formatJsonFileSnapshot } from "../../helpers/file-snapshot";
import {
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { E2E_TAGS } from "../../helpers/tags";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const autoHookClaudeAgentSDKScenarios =
  await getClaudeAgentSDKAutoHookScenarios(scenarioDir);

for (const scenario of autoHookClaudeAgentSDKScenarios) {
  test(
    `claude agent sdk auto-instrumentation via node hook collects the shared claude agent trace contract (claude-agent-sdk ${scenario.version})`,
    {
      tags: [E2E_TAGS.externalApi],
      timeout: CLAUDE_AGENT_SDK_SCENARIO_TIMEOUT_MS,
    },
    async () => {
      await withScenarioHarness(async ({ events, runNodeScenarioDir }) => {
        await runNodeScenarioDir({
          entry: scenario.entry,
          nodeArgs: ["--import", "braintrust/hook.mjs"],
          scenarioDir,
          timeoutMs: CLAUDE_AGENT_SDK_SCENARIO_TIMEOUT_MS,
        });

        const contract = assertClaudeAgentSDKTraceContract({
          capturedEvents: events(),
          rootName: "claude-agent-sdk-auto-hook-root",
          scenarioName: "claude-agent-sdk-auto-instrumentation-node-hook",
        });

        await expect(
          formatJsonFileSnapshot(contract.spanSummary),
        ).toMatchFileSnapshot(
          resolveClaudeAgentSDKSpanSnapshotPath(scenario.dependencyName),
        );
      });
    },
  );
}
