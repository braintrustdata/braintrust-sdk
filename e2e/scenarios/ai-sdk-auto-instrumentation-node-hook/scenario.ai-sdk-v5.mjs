import { openai } from "ai-sdk-openai-v5";
import * as ai from "ai-sdk-v5";
import { getInstalledPackageVersion } from "../../helpers/provider-runtime.mjs";
import { runAISDKAutoInstrumentationNodeHookOrExit } from "./scenario.impl.mjs";

runAISDKAutoInstrumentationNodeHookOrExit({
  agentClassExport: "Experimental_Agent",
  ai,
  agentSpanName: "Agent",
  maxTokensKey: "maxOutputTokens",
  openai,
  sdkVersion: await getInstalledPackageVersion(import.meta.url, "ai-sdk-v5"),
  supportsGenerateObject: true,
  supportsStreamObject: true,
  supportsToolExecution: true,
  toolSchemaKey: "inputSchema",
});
