import { openai } from "ai-sdk-openai-v4";
import * as ai from "ai-sdk-v4";
import {
  getInstalledPackageVersion,
  runMain,
} from "../../helpers/scenario-runtime";
import { runWrapAISDKGenerationTraces } from "./scenario.impl";

runMain(async () =>
  runWrapAISDKGenerationTraces({
    ai,
    maxTokensKey: "maxTokens",
    openai,
    sdkVersion: await getInstalledPackageVersion(import.meta.url, "ai-sdk-v4"),
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: false,
    toolSchemaKey: "parameters",
  }),
);
