import { describe, it, expect, vi, beforeAll } from "vitest";

// This test file specifically tests the behavior when OpenTelemetry is not installed.
// It should run as part of our core / default test suite.

describe("OpenTelemetry not installed", () => {
  let otelInstalled = false;
  let originalConsoleWarn: any;

  beforeAll(() => {
    // Check if OpenTelemetry is actually installed - do this once for the whole suite
    try {
      require("@opentelemetry/api");
      otelInstalled = true;
    } catch (error) {
      otelInstalled = false;
    }

    if (otelInstalled) {
      console.warn(
        "OpenTelemetry IS installed, skipping tests that require it to be missing",
      );
    }

    // Set up console.warn mock for all tests
    originalConsoleWarn = console.warn;
    console.warn = vi.fn();
  });

  it("should warn when importing the module without OpenTelemetry", async () => {
    if (otelInstalled) {
      // Skip this test if OpenTelemetry is installed
      return;
    }

    try {
      // This should trigger the warning in the module's top-level import
      const { AISpanProcessor } = await import(".");

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("OpenTelemetry packages are not installed"),
      );
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  it("should throw error when creating AISpanProcessor without OpenTelemetry", async () => {
    if (otelInstalled) {
      // Skip this test if OpenTelemetry is installed
      return;
    }

    const { AISpanProcessor } = await import(".");

    expect(() => {
      new AISpanProcessor({} as any);
    }).toThrow("OpenTelemetry packages are not installed");
  });

  it("should throw error when creating BraintrustSpanProcessor without OpenTelemetry", async () => {
    if (otelInstalled) {
      // Skip this test if OpenTelemetry is installed
      return;
    }

    const { BraintrustSpanProcessor } = await import(".");

    expect(() => {
      new BraintrustSpanProcessor({
        apiKey: "test-api-key",
      });
    }).toThrow("OpenTelemetry packages are not installed");
  });

  it("should return undefined when calling otelContextFromSpanExport without OpenTelemetry", async () => {
    if (otelInstalled) {
      // Skip this test if OpenTelemetry is installed
      return;
    }

    const { otelContextFromSpanExport } = await import(".");

    const result = otelContextFromSpanExport("some-export-string");
    expect(result).toBeUndefined();
  });
});
