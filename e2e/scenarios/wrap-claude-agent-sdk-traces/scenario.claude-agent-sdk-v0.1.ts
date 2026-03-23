import * as claudeAgentSDK from "claude-agent-sdk-v0.1";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapClaudeAgentSDKTraces } from "./scenario.impl";

runMain(async () => runWrapClaudeAgentSDKTraces(claudeAgentSDK));
