import * as claudeAgentSDK from "claude-agent-sdk-v0.2";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapClaudeAgentSDKTraces } from "./scenario.impl";

runMain(async () => runWrapClaudeAgentSDKTraces(claudeAgentSDK));
