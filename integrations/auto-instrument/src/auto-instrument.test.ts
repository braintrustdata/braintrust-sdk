import { describe, it, expect, beforeAll } from "vitest";
import { setupAutoInstrumentation } from "./index";

describe("Auto-instrumentation", () => {
  beforeAll(async () => {
    // Ensure braintrust is loaded to register global wrappers
    await import("braintrust");
  });

  it("should export setupAutoInstrumentation function", () => {
    expect(typeof setupAutoInstrumentation).toBe("function");
  });

  it("should load configuration", async () => {
    const { loadConfig } = await import("./config");
    const config = loadConfig();
    expect(config).toHaveProperty("enabled");
    expect(config).toHaveProperty("include");
    expect(config).toHaveProperty("exclude");
    expect(config).toHaveProperty("debug");
  });

  it("should gracefully handle missing otel package", async () => {
    const { detectAndSetupOtel } = await import("./util");
    const { loadConfig } = await import("./config");
    const config = loadConfig();

    // Should return false when @braintrust/otel is not installed
    // (or true if it happens to be installed and registered on globalThis)
    const result = detectAndSetupOtel(config);
    expect(typeof result).toBe("boolean");
  });
});
