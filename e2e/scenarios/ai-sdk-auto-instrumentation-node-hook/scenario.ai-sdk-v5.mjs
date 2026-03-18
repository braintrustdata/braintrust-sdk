import { openai } from "ai-sdk-openai-v5";
import * as ai from "ai-sdk-v5";
import { runAISDKAutoInstrumentationNodeHookOrExit } from "./scenario.impl.mjs";

runAISDKAutoInstrumentationNodeHookOrExit(
  ai,
  openai,
  "5.0.82",
  "Experimental_Agent",
);
