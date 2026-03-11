import { openai } from "ai-sdk-openai-v6";
import * as ai from "ai-sdk-v6";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapAISDKGenerationTraces } from "./scenario.impl";

runMain(() =>
  runWrapAISDKGenerationTraces({
    ai,
    maxTokensKey: "maxOutputTokens",
    openai,
    sdkVersion: "6.0.1",
    supportsGenerateObject: true,
    supportsToolExecution: true,
    toolSchemaKey: "inputSchema",
  }),
);
