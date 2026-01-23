import { describe, it, expect } from "vitest";
import { claudeAgentSDKConfigs } from "./claude-agent-sdk";

describe("Claude Agent SDK Instrumentation Configs", () => {
  it("should have valid configs", () => {
    expect(claudeAgentSDKConfigs).toBeDefined();
    expect(Array.isArray(claudeAgentSDKConfigs)).toBe(true);
    expect(claudeAgentSDKConfigs.length).toBeGreaterThan(0);
  });

  it("should have query config", () => {
    const config = claudeAgentSDKConfigs.find((c) => c.channelName === "query");

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("@anthropic-ai/claude-agent-sdk");
    expect(config?.module.versionRange).toBe(">=0.1.0");
    expect(config?.module.filePath).toBe("sdk.mjs");
    expect((config?.functionQuery as any).className).toBe("Agent");
    expect((config?.functionQuery as any).methodName).toBe("query");
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should NOT include braintrust: prefix (code-transformer adds orchestrion:claude-agent-sdk: prefix)", () => {
    for (const config of claudeAgentSDKConfigs) {
      expect(config.channelName).not.toContain("braintrust:");
      expect(config.channelName).not.toContain("orchestrion:");
    }
  });

  it("should target @anthropic-ai/claude-agent-sdk package for all configs", () => {
    for (const config of claudeAgentSDKConfigs) {
      expect(config.module.name).toBe("@anthropic-ai/claude-agent-sdk");
    }
  });

  it("should have valid version range", () => {
    for (const config of claudeAgentSDKConfigs) {
      expect(config.module.versionRange).toMatch(/^>=\d+\.\d+\.\d+$/);
    }
  });

  it("should have valid function kind", () => {
    const validKinds = ["Async", "Sync", "Callback"];
    for (const config of claudeAgentSDKConfigs) {
      expect(validKinds).toContain((config.functionQuery as any).kind);
    }
  });
});
