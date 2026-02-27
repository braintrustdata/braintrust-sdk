import { describe, it, expect } from "vitest";
import { googleADKConfigs } from "./google-adk";

describe("Google ADK Instrumentation Configs", () => {
  it("should have valid configs", () => {
    expect(googleADKConfigs).toBeDefined();
    expect(Array.isArray(googleADKConfigs)).toBe(true);
    expect(googleADKConfigs).toHaveLength(4);
  });

  it("should have runner.runAsync config", () => {
    const config = googleADKConfigs.find(
      (c) => c.channelName === "runner.runAsync",
    );

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("@google/adk");
    expect(config?.module.versionRange).toBe(">=0.1.0");
    expect(config?.module.filePath).toBe("dist/esm/index.js");
    expect((config?.functionQuery as any).className).toBe("Runner");
    expect((config?.functionQuery as any).methodName).toBe("runAsync");
    expect((config?.functionQuery as any).kind).toBe("Async");
    expect((config?.functionQuery as any).isExportAlias).toBe(true);
  });

  it("should have agent.runAsync config", () => {
    const config = googleADKConfigs.find(
      (c) => c.channelName === "agent.runAsync",
    );

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("@google/adk");
    expect(config?.module.versionRange).toBe(">=0.1.0");
    expect(config?.module.filePath).toBe("dist/esm/index.js");
    expect((config?.functionQuery as any).className).toBe("BaseAgent");
    expect((config?.functionQuery as any).methodName).toBe("runAsync");
    expect((config?.functionQuery as any).kind).toBe("Async");
    expect((config?.functionQuery as any).isExportAlias).toBe(true);
  });

  it("should have llm.callLlmAsync config", () => {
    const config = googleADKConfigs.find(
      (c) => c.channelName === "llm.callLlmAsync",
    );

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("@google/adk");
    expect(config?.module.versionRange).toBe(">=0.1.0");
    expect(config?.module.filePath).toBe("dist/esm/index.js");
    expect((config?.functionQuery as any).className).toBe("LlmAgent");
    expect((config?.functionQuery as any).methodName).toBe("callLlmAsync");
    expect((config?.functionQuery as any).kind).toBe("Async");
    expect((config?.functionQuery as any).isExportAlias).toBe(true);
  });

  it("should have mcpTool.runAsync config", () => {
    const config = googleADKConfigs.find(
      (c) => c.channelName === "mcpTool.runAsync",
    );

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("@google/adk");
    expect(config?.module.versionRange).toBe(">=0.1.0");
    expect(config?.module.filePath).toBe("dist/esm/index.js");
    expect((config?.functionQuery as any).className).toBe("MCPTool");
    expect((config?.functionQuery as any).methodName).toBe("runAsync");
    expect((config?.functionQuery as any).kind).toBe("Async");
    expect((config?.functionQuery as any).isExportAlias).toBe(true);
  });

  it("should NOT include braintrust: or orchestrion: prefix (code-transformer adds orchestrion:google-adk: prefix)", () => {
    for (const config of googleADKConfigs) {
      expect(config.channelName).not.toContain("braintrust:");
      expect(config.channelName).not.toContain("orchestrion:");
    }
  });

  it("should target @google/adk package for all configs", () => {
    for (const config of googleADKConfigs) {
      expect(config.module.name).toBe("@google/adk");
    }
  });

  it("should have valid version ranges", () => {
    for (const config of googleADKConfigs) {
      expect(config.module.versionRange).toMatch(/^>=\d+\.\d+\.\d+$/);
    }
  });

  it("should have valid function kinds", () => {
    const validKinds = ["Async", "Sync", "Callback"];
    for (const config of googleADKConfigs) {
      expect(validKinds).toContain((config.functionQuery as any).kind);
    }
  });

  it("should use Async kind for all methods", () => {
    for (const config of googleADKConfigs) {
      expect((config.functionQuery as any).kind).toBe("Async");
    }
  });

  it("should use isExportAlias for all configs", () => {
    for (const config of googleADKConfigs) {
      expect((config.functionQuery as any).isExportAlias).toBe(true);
    }
  });

  it("should target dist/esm/index.js for all configs", () => {
    for (const config of googleADKConfigs) {
      expect(config.module.filePath).toBe("dist/esm/index.js");
    }
  });
});
