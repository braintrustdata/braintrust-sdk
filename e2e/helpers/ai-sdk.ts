import { readInstalledPackageVersion } from "./scenario-installer";

export interface WrapAISDKScenario {
  agentClassExport?: "Experimental_Agent" | "ToolLoopAgent";
  agentSpanName?: string;
  dependencyName: string;
  entry: string;
  supportsGenerateObject: boolean;
  supportsStreamObject: boolean;
  supportsToolExecution: boolean;
  version: string;
}

export interface AISDKAutoHookScenario {
  agentClassExport?: "Experimental_Agent" | "ToolLoopAgent";
  agentSpanName?: "Agent" | "ToolLoopAgent";
  dependencyName: string;
  entry: string;
  maxTokensKey: "maxOutputTokens" | "maxTokens";
  openaiDependencyName: string;
  openaiModuleName: string;
  packageName: string;
  supportsGenerateObject: boolean;
  supportsStreamObject: boolean;
  supportsToolExecution: boolean;
  toolSchemaKey: "inputSchema" | "parameters";
  version: string;
}

export const AI_SDK_SCENARIO_TIMEOUT_MS = 120_000;

const AI_SDK_SCENARIO_SPECS = [
  {
    dependencyName: "ai-sdk-v3",
    entryMjs: "scenario.ai-sdk-v3.mjs",
    entry: "scenario.ai-sdk-v3.ts",
    maxTokensKey: "maxTokens",
    openaiDependencyName: "ai-sdk-openai-v3",
    openaiModuleName: "ai-sdk-openai-v3",
    packageName: "ai-sdk-v3",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: false,
    toolSchemaKey: "parameters",
  },
  {
    dependencyName: "ai-sdk-v4",
    entryMjs: "scenario.ai-sdk-v4.mjs",
    entry: "scenario.ai-sdk-v4.ts",
    maxTokensKey: "maxTokens",
    openaiDependencyName: "ai-sdk-openai-v4",
    openaiModuleName: "ai-sdk-openai-v4",
    packageName: "ai-sdk-v4",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: false,
    toolSchemaKey: "parameters",
  },
  {
    agentClassExport: "Experimental_Agent",
    agentSpanName: "Agent",
    dependencyName: "ai-sdk-v5",
    entryMjs: "scenario.ai-sdk-v5.mjs",
    entry: "scenario.ai-sdk-v5.ts",
    maxTokensKey: "maxOutputTokens",
    openaiDependencyName: "ai-sdk-openai-v5",
    openaiModuleName: "ai-sdk-openai-v5",
    packageName: "ai-sdk-v5",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: true,
    toolSchemaKey: "inputSchema",
  },
  {
    agentClassExport: "ToolLoopAgent",
    agentSpanName: "ToolLoopAgent",
    dependencyName: "ai-sdk-v6",
    entryMjs: "scenario.ai-sdk-v6.mjs",
    entry: "scenario.ai-sdk-v6.ts",
    maxTokensKey: "maxOutputTokens",
    openaiDependencyName: "ai-sdk-openai-v6",
    openaiModuleName: "ai-sdk-openai-v6",
    packageName: "ai-sdk-v6",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: true,
    toolSchemaKey: "inputSchema",
  },
] as const;

export async function getWrapAISDKScenarios(
  scenarioDir: string,
): Promise<WrapAISDKScenario[]> {
  return await Promise.all(
    AI_SDK_SCENARIO_SPECS.map(async (scenario) => ({
      ...scenario,
      version: await readInstalledPackageVersion(
        scenarioDir,
        scenario.dependencyName,
      ),
    })),
  );
}

export async function getAISDKAutoHookScenarios(
  scenarioDir: string,
): Promise<AISDKAutoHookScenario[]> {
  return await Promise.all(
    AI_SDK_SCENARIO_SPECS.map(async (scenario) => ({
      agentClassExport: scenario.agentClassExport,
      agentSpanName: scenario.agentSpanName,
      dependencyName: scenario.dependencyName,
      entry: scenario.entryMjs,
      maxTokensKey: scenario.maxTokensKey,
      openaiDependencyName: scenario.openaiDependencyName,
      openaiModuleName: scenario.openaiModuleName,
      packageName: scenario.packageName,
      supportsGenerateObject: scenario.supportsGenerateObject,
      supportsStreamObject: scenario.supportsStreamObject,
      supportsToolExecution: scenario.supportsToolExecution,
      toolSchemaKey: scenario.toolSchemaKey,
      version: await readInstalledPackageVersion(
        scenarioDir,
        scenario.dependencyName,
      ),
    })),
  );
}
