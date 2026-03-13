export interface WrapAISDKScenario {
  agentClassExport?: "Experimental_Agent" | "ToolLoopAgent";
  agentSpanName?: string;
  entry: string;
  supportsGenerateObject: boolean;
  supportsStreamObject: boolean;
  supportsToolExecution: boolean;
  version: string;
}

export const AI_SDK_SCENARIO_TIMEOUT_MS = 120_000;

export const WRAP_AI_SDK_SCENARIOS: WrapAISDKScenario[] = [
  {
    entry: "scenario.ai-sdk-v3.ts",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: false,
    version: "3.4.33",
  },
  {
    entry: "scenario.ai-sdk-v4.ts",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: false,
    version: "4.3.19",
  },
  {
    agentClassExport: "Experimental_Agent",
    agentSpanName: "Agent",
    entry: "scenario.ai-sdk-v5.ts",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: true,
    version: "5.0.82",
  },
  {
    agentClassExport: "ToolLoopAgent",
    agentSpanName: "ToolLoopAgent",
    entry: "scenario.ai-sdk-v6.ts",
    supportsGenerateObject: true,
    supportsStreamObject: true,
    supportsToolExecution: true,
    version: "6.0.1",
  },
];
