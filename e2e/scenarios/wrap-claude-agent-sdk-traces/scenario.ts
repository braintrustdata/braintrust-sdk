import { wrapClaudeAgentSDK } from "braintrust";
import * as mockSDK from "../../helpers/mock-claude-agent-sdk/sdk.mjs";
import { runClaudeAgentSDKScenario } from "../../helpers/claude-agent-sdk-scenario.mjs";
import { runMain } from "../../helpers/scenario-runtime";

runMain(async () =>
  runClaudeAgentSDKScenario({
    decorateSDK: wrapClaudeAgentSDK,
    projectNameBase: "e2e-wrap-claude-agent-sdk",
    rootName: "claude-agent-sdk-wrapper-root",
    scenarioName: "wrap-claude-agent-sdk-traces",
    sdk: mockSDK,
  }),
);
