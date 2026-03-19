import { openai } from "ai-sdk-openai-v3";
import * as ai from "ai-sdk-v3";
import { getInstalledPackageVersion } from "../../helpers/provider-runtime.mjs";
import { runAISDKAutoInstrumentationNodeHookOrExit } from "./scenario.impl.mjs";

runAISDKAutoInstrumentationNodeHookOrExit({
  ai,
  maxTokensKey: "maxTokens",
  openai,
  sdkVersion: await getInstalledPackageVersion(import.meta.url, "ai-sdk-v3"),
  supportsGenerateObject: true,
  supportsStreamObject: true,
  supportsToolExecution: false,
  toolSchemaKey: "parameters",
});
