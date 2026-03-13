import { openai } from "ai-sdk-openai-v5";
import * as ai from "ai-sdk-v5";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapAISDKGenerationTraces } from "./scenario.impl";

runMain(() =>
  runWrapAISDKGenerationTraces({
    agentClassExport: "Experimental_Agent",
    ai,
    maxTokensKey: "maxOutputTokens",
    openai,
    sdkVersion: "5.0.82",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: true,
    toolSchemaKey: "inputSchema",
  }),
);
