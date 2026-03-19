import * as claudeAgentSDK from "@anthropic-ai/claude-agent-sdk";
import { runClaudeAgentSDKScenario } from "../../helpers/claude-agent-sdk-scenario.mjs";
import { runMain } from "../../helpers/provider-runtime.mjs";

runMain(async () =>
  runClaudeAgentSDKScenario({
    projectNameBase: "e2e-claude-agent-sdk-auto-instrumentation-hook",
    rootName: "claude-agent-sdk-auto-hook-root",
    scenarioName: "claude-agent-sdk-auto-instrumentation-node-hook",
    sdk: claudeAgentSDK,
  }),
);
