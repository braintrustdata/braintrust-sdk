export interface WrapAISDKScenario {
  entry: string;
  supportsGenerateObject: boolean;
  supportsToolExecution: boolean;
  version: string;
}

export const AI_SDK_SCENARIO_TIMEOUT_MS = 120_000;

export const WRAP_AI_SDK_SCENARIOS: WrapAISDKScenario[] = [
  {
    entry: "scenario.ai-sdk-v3.ts",
    supportsGenerateObject: false,
    supportsToolExecution: false,
    version: "3.4.33",
  },
  {
    entry: "scenario.ai-sdk-v4.ts",
    supportsGenerateObject: false,
    supportsToolExecution: false,
    version: "4.3.19",
  },
  {
    entry: "scenario.ai-sdk-v5.ts",
    supportsGenerateObject: true,
    supportsToolExecution: true,
    version: "5.0.82",
  },
  {
    entry: "scenario.ai-sdk-v6.ts",
    supportsGenerateObject: true,
    supportsToolExecution: true,
    version: "6.0.1",
  },
];
