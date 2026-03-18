import { describe, expect, it } from "vitest";
import { aiSDKConfigs } from "./ai-sdk";

function findConfigs(channelName: string) {
  return aiSDKConfigs.filter((config) => config.channelName === channelName);
}

describe("AI SDK Instrumentation Configs", () => {
  it("should have valid configs", () => {
    expect(aiSDKConfigs).toBeDefined();
    expect(Array.isArray(aiSDKConfigs)).toBe(true);
    expect(aiSDKConfigs.length).toBeGreaterThan(0);
  });

  it("should instrument generateText for both ESM and CJS", () => {
    const configs = findConfigs("generateText");

    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.module.filePath).sort()).toEqual([
      "dist/index.js",
      "dist/index.mjs",
    ]);
    for (const config of configs) {
      expect(config.module.name).toBe("ai");
      expect(config.module.versionRange).toBe(">=3.0.0");
      expect((config.functionQuery as any).functionName).toBe("generateText");
      expect((config.functionQuery as any).kind).toBe("Async");
    }
  });

  it("should instrument streamText for ESM async and CJS sync", () => {
    const esmConfigs = findConfigs("streamText");
    const cjsConfigs = findConfigs("streamText.sync");

    expect(esmConfigs).toHaveLength(1);
    expect(esmConfigs[0]?.module.filePath).toBe("dist/index.mjs");
    expect((esmConfigs[0]?.functionQuery as any).functionName).toBe(
      "streamText",
    );
    expect((esmConfigs[0]?.functionQuery as any).kind).toBe("Async");

    expect(cjsConfigs).toHaveLength(1);
    expect(cjsConfigs[0]?.module.filePath).toBe("dist/index.js");
    expect((cjsConfigs[0]?.functionQuery as any).functionName).toBe(
      "streamText",
    );
    expect((cjsConfigs[0]?.functionQuery as any).kind).toBe("Sync");
  });

  it("should instrument generateObject for both ESM and CJS", () => {
    const configs = findConfigs("generateObject");

    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.module.filePath).sort()).toEqual([
      "dist/index.js",
      "dist/index.mjs",
    ]);
    for (const config of configs) {
      expect(config.module.name).toBe("ai");
      expect(config.module.versionRange).toBe(">=3.0.0");
      expect((config.functionQuery as any).functionName).toBe("generateObject");
      expect((config.functionQuery as any).kind).toBe("Async");
    }
  });

  it("should instrument streamObject for ESM async and CJS sync", () => {
    const esmConfigs = findConfigs("streamObject");
    const cjsConfigs = findConfigs("streamObject.sync");

    expect(esmConfigs).toHaveLength(1);
    expect(esmConfigs[0]?.module.filePath).toBe("dist/index.mjs");
    expect((esmConfigs[0]?.functionQuery as any).functionName).toBe(
      "streamObject",
    );
    expect((esmConfigs[0]?.functionQuery as any).kind).toBe("Async");

    expect(cjsConfigs).toHaveLength(1);
    expect(cjsConfigs[0]?.module.filePath).toBe("dist/index.js");
    expect((cjsConfigs[0]?.functionQuery as any).functionName).toBe(
      "streamObject",
    );
    expect((cjsConfigs[0]?.functionQuery as any).kind).toBe("Sync");
  });

  it("should instrument Agent.generate for both ESM and CJS", () => {
    const configs = findConfigs("Agent.generate");

    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.module.filePath).sort()).toEqual([
      "dist/index.js",
      "dist/index.mjs",
    ]);
    for (const config of configs) {
      expect(config.module.versionRange).toBe(">=5.0.0 <6.0.0");
      expect((config.functionQuery as any).methodName).toBe("generate");
      expect((config.functionQuery as any).index).toBe(0);
      expect((config.functionQuery as any).kind).toBe("Async");
    }
  });

  it("should instrument Agent.stream for both ESM and CJS", () => {
    const configs = findConfigs("Agent.stream");

    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.module.filePath).sort()).toEqual([
      "dist/index.js",
      "dist/index.mjs",
    ]);
    for (const config of configs) {
      expect(config.module.versionRange).toBe(">=5.0.0 <6.0.0");
      expect((config.functionQuery as any).methodName).toBe("stream");
      expect((config.functionQuery as any).index).toBe(0);
      expect((config.functionQuery as any).kind).toBe("Async");
    }
  });

  it("should instrument ToolLoopAgent.generate for both ESM and CJS", () => {
    const configs = findConfigs("ToolLoopAgent.generate");

    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.module.filePath).sort()).toEqual([
      "dist/index.js",
      "dist/index.mjs",
    ]);
    for (const config of configs) {
      expect(config.module.versionRange).toBe(">=6.0.0 <7.0.0");
      expect((config.functionQuery as any).methodName).toBe("generate");
      expect((config.functionQuery as any).index).toBe(0);
      expect((config.functionQuery as any).kind).toBe("Async");
    }
  });

  it("should instrument ToolLoopAgent.stream for both ESM and CJS", () => {
    const configs = findConfigs("ToolLoopAgent.stream");

    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.module.filePath).sort()).toEqual([
      "dist/index.js",
      "dist/index.mjs",
    ]);
    for (const config of configs) {
      expect(config.module.versionRange).toBe(">=6.0.0 <7.0.0");
      expect((config.functionQuery as any).methodName).toBe("stream");
      expect((config.functionQuery as any).index).toBe(0);
      expect((config.functionQuery as any).kind).toBe("Async");
    }
  });

  it("should NOT include braintrust: or orchestrion: prefixes", () => {
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

  it("should only target dist/index.js and dist/index.mjs", () => {
    const filePaths = new Set(
      aiSDKConfigs.map((config) => config.module.filePath),
    );
    expect([...filePaths].sort()).toEqual(["dist/index.js", "dist/index.mjs"]);
  });

  it("should have valid version ranges", () => {
    for (const config of aiSDKConfigs) {
      expect(config.module.versionRange).toMatch(
        /^>=\d+\.\d+\.\d+( <\d+\.\d+\.\d+)?$/,
      );
    }
  });

  it("should have valid function kinds", () => {
    const validKinds = ["Async", "Sync", "Callback"];
    for (const config of aiSDKConfigs) {
      expect(validKinds).toContain((config.functionQuery as any).kind);
    }
  });
});
