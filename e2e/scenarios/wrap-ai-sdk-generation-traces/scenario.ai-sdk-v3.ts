import { openai } from "ai-sdk-openai-v3";
import * as ai from "ai-sdk-v3";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapAISDKGenerationTraces } from "./scenario.impl";

runMain(() =>
  runWrapAISDKGenerationTraces({
    ai,
    maxTokensKey: "maxTokens",
    openai,
    sdkVersion: "3.4.33",
    supportsGenerateObject: false,
    supportsToolExecution: false,
    toolSchemaKey: "parameters",
  }),
);
