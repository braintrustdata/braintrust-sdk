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

export const AI_SDK_SCENARIO_TIMEOUT_MS = 120_000;

const AI_SDK_SCENARIO_SPECS = [
  {
    dependencyName: "ai-sdk-v3",
    entry: "scenario.ai-sdk-v3.ts",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: false,
  },
  {
    dependencyName: "ai-sdk-v4",
    entry: "scenario.ai-sdk-v4.ts",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: false,
  },
  {
    agentClassExport: "Experimental_Agent",
    agentSpanName: "Agent",
    dependencyName: "ai-sdk-v5",
    entry: "scenario.ai-sdk-v5.ts",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: true,
  },
  {
    agentClassExport: "ToolLoopAgent",
    agentSpanName: "ToolLoopAgent",
    dependencyName: "ai-sdk-v6",
    entry: "scenario.ai-sdk-v6.ts",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: true,
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
