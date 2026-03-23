import {
  getInstalledPackageVersion,
  runMain,
} from "../../helpers/provider-runtime.mjs";
import { runClaudeAgentSDKScenario } from "../../helpers/claude-agent-sdk-scenario.mjs";

export { getInstalledPackageVersion };

export async function runClaudeAgentSDKAutoInstrumentationNodeHook(
  claudeAgentSDK,
) {
  await runClaudeAgentSDKScenario({
    projectNameBase: "e2e-claude-agent-sdk-auto-instrumentation-hook",
    rootName: "claude-agent-sdk-auto-hook-root",
    scenarioName: "claude-agent-sdk-auto-instrumentation-node-hook",
    sdk: claudeAgentSDK,
  });
}

export function runClaudeAgentSDKAutoInstrumentationNodeHookOrExit(
  claudeAgentSDK,
) {
  runMain(async () =>
    runClaudeAgentSDKAutoInstrumentationNodeHook(claudeAgentSDK),
  );
}
