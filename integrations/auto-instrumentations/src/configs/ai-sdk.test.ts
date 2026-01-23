import { describe, it, expect } from "vitest";
import { aiSDKConfigs } from "./ai-sdk";

describe("AI SDK Instrumentation Configs", () => {
  it("should have valid configs", () => {
    expect(aiSDKConfigs).toBeDefined();
    expect(Array.isArray(aiSDKConfigs)).toBe(true);
    expect(aiSDKConfigs.length).toBeGreaterThan(0);
  });

  it("should have generateText config", () => {
    const config = aiSDKConfigs.find((c) => c.channelName === "generateText");

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("ai");
    expect(config?.module.versionRange).toBe(">=3.0.0");
    expect(config?.module.filePath).toBe("dist/index.mjs");
    expect((config?.functionQuery as any).functionName).toBe("generateText");
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should have streamText config", () => {
    const config = aiSDKConfigs.find((c) => c.channelName === "streamText");

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("ai");
    expect(config?.module.versionRange).toBe(">=3.0.0");
    expect((config?.functionQuery as any).functionName).toBe("streamText");
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should have generateObject config", () => {
    const config = aiSDKConfigs.find((c) => c.channelName === "generateObject");

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("ai");
    expect((config?.functionQuery as any).functionName).toBe("generateObject");
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should have streamObject config", () => {
    const config = aiSDKConfigs.find((c) => c.channelName === "streamObject");

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("ai");
    expect((config?.functionQuery as any).functionName).toBe("streamObject");
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should have Agent.generate config", () => {
    const config = aiSDKConfigs.find((c) => c.channelName === "Agent.generate");

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("ai");
    expect((config?.functionQuery as any).className).toBe("Agent");
    expect((config?.functionQuery as any).methodName).toBe("generate");
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should have Agent.stream config", () => {
    const config = aiSDKConfigs.find((c) => c.channelName === "Agent.stream");

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("ai");
    expect((config?.functionQuery as any).className).toBe("Agent");
    expect((config?.functionQuery as any).methodName).toBe("stream");
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should NOT include braintrust: prefix (code-transformer adds orchestrion:ai-sdk: prefix)", () => {
    for (const config of aiSDKConfigs) {
      expect(config.channelName).not.toContain("braintrust:");
      expect(config.channelName).not.toContain("orchestrion:");
    }
  });

  it("should target ai package for all configs", () => {
    for (const config of aiSDKConfigs) {
      expect(config.module.name).toBe("ai");
    }
  });

  it("should have valid version ranges", () => {
    for (const config of aiSDKConfigs) {
      expect(config.module.versionRange).toMatch(/^>=\d+\.\d+\.\d+$/);
    }
  });

  it("should have valid function kinds", () => {
    const validKinds = ["Async", "Sync", "Callback"];
    for (const config of aiSDKConfigs) {
      expect(validKinds).toContain((config.functionQuery as any).kind);
    }
  });

  it("should have consistent file paths", () => {
    for (const config of aiSDKConfigs) {
      expect(config.module.filePath).toBe("dist/index.mjs");
    }
  });

  it("should support version range >=3.0.0", () => {
    for (const config of aiSDKConfigs) {
      expect(config.module.versionRange).toBe(">=3.0.0");
    }
  });
});
