import { describe, it, expect } from "vitest";
import { googleGenAIConfigs } from "./google-genai";

describe("Google GenAI Instrumentation Configs", () => {
  it("should have valid configs", () => {
    expect(googleGenAIConfigs).toBeDefined();
    expect(Array.isArray(googleGenAIConfigs)).toBe(true);
    expect(googleGenAIConfigs.length).toBeGreaterThan(0);
  });

  it("should have models.generateContent config", () => {
    const config = googleGenAIConfigs.find(
      (c) => c.channelName === "models.generateContent",
    );

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("@google/genai");
    expect(config?.module.versionRange).toBe(">=1.0.0");
    expect(config?.module.filePath).toBe("dist/node/index.mjs");
    expect((config?.functionQuery as any).className).toBe("Models");
    expect((config?.functionQuery as any).methodName).toBe(
      "generateContentInternal",
    );
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should have models.generateContentStream config", () => {
    const config = googleGenAIConfigs.find(
      (c) => c.channelName === "models.generateContentStream",
    );

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("@google/genai");
    expect(config?.module.versionRange).toBe(">=1.0.0");
    expect(config?.module.filePath).toBe("dist/node/index.mjs");
    expect((config?.functionQuery as any).className).toBe("Models");
    expect((config?.functionQuery as any).methodName).toBe(
      "generateContentStreamInternal",
    );
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should NOT include braintrust: or orchestrion: prefix (code-transformer adds orchestrion:google-genai: prefix)", () => {
    for (const config of googleGenAIConfigs) {
      expect(config.channelName).not.toContain("braintrust:");
      expect(config.channelName).not.toContain("orchestrion:");
    }
  });

  it("should target @google/genai package for all configs", () => {
    for (const config of googleGenAIConfigs) {
      expect(config.module.name).toBe("@google/genai");
    }
  });

  it("should have valid version ranges", () => {
    for (const config of googleGenAIConfigs) {
      expect(config.module.versionRange).toMatch(/^>=\d+\.\d+\.\d+$/);
    }
  });

  it("should have valid function kinds", () => {
    const validKinds = ["Async", "Sync", "Callback"];
    for (const config of googleGenAIConfigs) {
      expect(validKinds).toContain((config.functionQuery as any).kind);
    }
  });

  it("should use Async kind for all methods", () => {
    for (const config of googleGenAIConfigs) {
      expect((config.functionQuery as any).kind).toBe("Async");
    }
  });

  it("should use Models class for all methods", () => {
    for (const config of googleGenAIConfigs) {
      expect((config.functionQuery as any).className).toBe("Models");
    }
  });
});
