export interface BraintrustConfig {
  apiUrl?: string;
  projectName?: string;
  orgName?: string;
  accessToken?: string;
}

export interface SetupOptions {
  projectPath: string;
  dryRun: boolean;
  backup: boolean;
}

export interface MCPAuthResult {
  accessToken: string;
  orgName: string;
  apiUrl: string;
}

export interface DetectionResult {
  hasOpenAI: boolean;
  hasAnthropic: boolean;
  hasLangChain: boolean;
  hasVercelAI: boolean;
  hasNextjs: boolean;
  packageManager: "npm" | "pnpm" | "yarn";
  language: "typescript" | "javascript";
}
