import { openai } from "ai-sdk-openai-v4";
import * as ai from "ai-sdk-v4";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapAISDKGenerationTraces } from "./scenario.impl";

runMain(() =>
  runWrapAISDKGenerationTraces({
    ai,
    maxTokensKey: "maxTokens",
    openai,
    sdkVersion: "4.3.19",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: false,
    toolSchemaKey: "parameters",
  }),
);
