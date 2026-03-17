import { openai } from "ai-sdk-openai-v6";
import * as ai from "ai-sdk-v6";
import { runAISDKAutoInstrumentationNodeHookOrExit } from "./scenario.impl.mjs";

runAISDKAutoInstrumentationNodeHookOrExit(ai, openai, "6.0.1", "ToolLoopAgent");
