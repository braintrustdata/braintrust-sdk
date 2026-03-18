import { openai } from "ai-sdk-openai-v4";
import * as ai from "ai-sdk-v4";
import { getInstalledPackageVersion } from "../../helpers/provider-runtime.mjs";
import { runAISDKAutoInstrumentationNodeHookOrExit } from "./scenario.impl.mjs";

runAISDKAutoInstrumentationNodeHookOrExit({
  ai,
  maxTokensKey: "maxTokens",
  openai,
  sdkVersion: await getInstalledPackageVersion(import.meta.url, "ai-sdk-v4"),
  supportsGenerateObject: true,
  supportsStreamObject: true,
  supportsToolExecution: false,
  toolSchemaKey: "parameters",
});
