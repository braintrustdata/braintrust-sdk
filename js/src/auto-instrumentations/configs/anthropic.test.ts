import { describe, it, expect } from "vitest";
import { anthropicConfigs } from "./anthropic";

describe("Anthropic Instrumentation Configs", () => {
  it("should have valid configs", () => {
    expect(anthropicConfigs).toBeDefined();
    expect(Array.isArray(anthropicConfigs)).toBe(true);
    expect(anthropicConfigs.length).toBeGreaterThan(0);
  });

  it("should have messages.create config", () => {
    const config = anthropicConfigs.find(
      (c) => c.channelName === "messages.create",
    );

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("@anthropic-ai/sdk");
    expect(config?.module.versionRange).toBe(">=0.60.0");
    expect(config?.module.filePath).toBe("resources/messages.mjs");
    expect((config?.functionQuery as any).className).toBe("Messages");
    expect((config?.functionQuery as any).methodName).toBe("create");
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should have beta.messages.create config", () => {
    const config = anthropicConfigs.find(
      (c) => c.channelName === "beta.messages.create",
    );

    expect(config).toBeDefined();
    expect(config?.module.name).toBe("@anthropic-ai/sdk");
    expect(config?.module.versionRange).toBe(">=0.60.0");
    expect(config?.module.filePath).toBe(
      "resources/beta/messages/messages.mjs",
    );
    expect((config?.functionQuery as any).className).toBe("Messages");
    expect((config?.functionQuery as any).methodName).toBe("create");
    expect((config?.functionQuery as any).kind).toBe("Async");
  });

  it("should NOT include braintrust: prefix (code-transformer adds orchestrion:anthropic: prefix)", () => {
    for (const config of anthropicConfigs) {
      expect(config.channelName).not.toContain("braintrust:");
      expect(config.channelName).not.toContain("orchestrion:");
    }
  });

  it("should target @anthropic-ai/sdk package for all configs", () => {
    for (const config of anthropicConfigs) {
      expect(config.module.name).toBe("@anthropic-ai/sdk");
    }
  });

  it("should have valid version ranges", () => {
    for (const config of anthropicConfigs) {
      expect(config.module.versionRange).toMatch(/^>=\d+\.\d+\.\d+$/);
    }
  });

  it("should have valid function kinds", () => {
    const validKinds = ["Async", "Sync", "Callback"];
    for (const config of anthropicConfigs) {
      expect(validKinds).toContain((config.functionQuery as any).kind);
    }
  });

  it("should have all configs with Async kind (messages.create supports streaming via stream parameter)", () => {
    for (const config of anthropicConfigs) {
      // All Anthropic message creation methods are async and support streaming via stream parameter
      expect((config.functionQuery as any).kind).toBe("Async");
    }
  });
});
