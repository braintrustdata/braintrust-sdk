import { wrapAISDK } from "braintrust";
import { z } from "zod";
import { runAISDKScenario } from "../../helpers/ai-sdk-scenario.mjs";

interface WrapAISDKGenerationOptions {
  agentClassExport?: "Experimental_Agent" | "ToolLoopAgent";
  ai: any;
  maxTokensKey: "maxOutputTokens" | "maxTokens";
  openai: (model: string) => unknown;
  sdkVersion: string;
  supportsGenerateObject: boolean;
  supportsStreamObject: boolean;
  supportsToolExecution: boolean;
  toolSchemaKey: "inputSchema" | "parameters";
}

export async function runWrapAISDKGenerationTraces(
  options: WrapAISDKGenerationOptions,
) {
  await runAISDKScenario({
    ...options,
    decorateAI: wrapAISDK,
    projectNameBase: "e2e-wrap-ai-sdk",
    rootName: "ai-sdk-wrapper-root",
    scenarioName: "wrap-ai-sdk-generation-traces",
    zod: z,
  });
}
