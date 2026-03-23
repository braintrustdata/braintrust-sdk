import { readInstalledPackageVersion } from "./scenario-installer";

interface ClaudeAgentSDKScenario {
  dependencyName: string;
  entry: string;
  version: string;
}

const CLAUDE_AGENT_SDK_VERSION_SPECS = [
  {
    dependencyName: "claude-agent-sdk-v0.1",
    suffix: "v0.1",
  },
  {
    dependencyName: "claude-agent-sdk-v0.2",
    suffix: "v0.2",
  },
] as const;

export const CLAUDE_AGENT_SDK_SCENARIO_TIMEOUT_MS = 120_000;

export async function getWrapClaudeAgentSDKScenarios(
  scenarioDir: string,
): Promise<ClaudeAgentSDKScenario[]> {
  return await Promise.all(
    CLAUDE_AGENT_SDK_VERSION_SPECS.map(async ({ dependencyName, suffix }) => ({
      dependencyName,
      entry: `scenario.claude-agent-sdk-${suffix}.ts`,
      version: await readInstalledPackageVersion(scenarioDir, dependencyName),
    })),
  );
}

export async function getClaudeAgentSDKAutoHookScenarios(
  scenarioDir: string,
): Promise<ClaudeAgentSDKScenario[]> {
  return await Promise.all(
    CLAUDE_AGENT_SDK_VERSION_SPECS.map(async ({ dependencyName, suffix }) => ({
      dependencyName,
      entry: `scenario.claude-agent-sdk-${suffix}.mjs`,
      version: await readInstalledPackageVersion(scenarioDir, dependencyName),
    })),
  );
}
