import { expect, test } from "vitest";
import {
  assertClaudeAgentSDKTraceContract,
  resolveClaudeAgentSDKSpanSnapshotPath,
} from "../../helpers/claude-agent-sdk-trace-contract";
import {
  CLAUDE_AGENT_SDK_SCENARIO_TIMEOUT_MS,
  getWrapClaudeAgentSDKScenarios,
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
const wrapClaudeAgentSDKScenarios =
  await getWrapClaudeAgentSDKScenarios(scenarioDir);

for (const scenario of wrapClaudeAgentSDKScenarios) {
  test(
    `wrap-claude-agent-sdk-traces captures tool, async prompt, and subagent traces (claude-agent-sdk ${scenario.version})`,
    {
      tags: [E2E_TAGS.externalApi],
      timeout: CLAUDE_AGENT_SDK_SCENARIO_TIMEOUT_MS,
    },
    async () => {
      await withScenarioHarness(async ({ events, runScenarioDir }) => {
        await runScenarioDir({
          entry: scenario.entry,
          scenarioDir,
          timeoutMs: CLAUDE_AGENT_SDK_SCENARIO_TIMEOUT_MS,
        });

        const contract = assertClaudeAgentSDKTraceContract({
          capturedEvents: events(),
          rootName: "claude-agent-sdk-wrapper-root",
          scenarioName: "wrap-claude-agent-sdk-traces",
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
