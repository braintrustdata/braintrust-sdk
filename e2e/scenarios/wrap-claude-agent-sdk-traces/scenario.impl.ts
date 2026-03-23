import { wrapClaudeAgentSDK } from "braintrust";
import { runClaudeAgentSDKScenario } from "../../helpers/claude-agent-sdk-scenario.mjs";

export async function runWrapClaudeAgentSDKTraces(claudeAgentSDK: object) {
  await runClaudeAgentSDKScenario({
    decorateSDK: wrapClaudeAgentSDK,
    projectNameBase: "e2e-wrap-claude-agent-sdk",
    rootName: "claude-agent-sdk-wrapper-root",
    scenarioName: "wrap-claude-agent-sdk-traces",
    sdk: claudeAgentSDK,
  });
}
