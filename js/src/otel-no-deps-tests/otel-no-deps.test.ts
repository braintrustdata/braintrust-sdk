import { describe, it, expect, vi, beforeAll } from "vitest";

// This test file specifically tests the behavior when OpenTelemetry is not installed.
// IMPORTANT: This test is run in an isolated workspace (otel-no-deps-tests) with a setup file
// that mocks require() to prevent OpenTelemetry packages from being resolved from parent workspaces.

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
      throw new Error(
        "OpenTelemetry IS installed in isolated workspace. " +
        "The otel-no-deps-tests workspace must not have OpenTelemetry packages installed. " +
        "This workspace is designed to test behavior when OTEL packages are missing."
      );
    }

    // Set up console.warn mock for all tests
    originalConsoleWarn = console.warn;
    console.warn = vi.fn();
  });

  it("should warn when importing the module without OpenTelemetry", async () => {
    try {
      // This should trigger the warning in the module's top-level import
      // Import from the parent directory
      const { AISpanProcessor } = await import("../otel");

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("OpenTelemetry packages are not installed"),
      );
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  it("should throw error when creating AISpanProcessor without OpenTelemetry", async () => {
    const { AISpanProcessor } = await import("../otel");

    expect(() => {
      new AISpanProcessor({} as any);
    }).toThrow("OpenTelemetry packages are not installed");
  });

  it("should throw error when creating BraintrustSpanProcessor without OpenTelemetry", async () => {
    const { BraintrustSpanProcessor } = await import("../otel");

    expect(() => {
      new BraintrustSpanProcessor({
        apiKey: "test-api-key",
      });
    }).toThrow("OpenTelemetry packages are not installed");
  });

  it("should return undefined when calling otelContextFromSpanExport without OpenTelemetry", async () => {
    const { otelContextFromSpanExport } = await import("../otel");

    const result = otelContextFromSpanExport("some-export-string");
    expect(result).toBeUndefined();
  });

  it("should not error when calling otel.addParentToBaggage without OpenTelemetry", async () => {
    const { otel } = await import("../otel");

    // Should not throw - may return undefined when OTEL is not available
    let result: any;
    expect(() => {
      result = otel.addParentToBaggage("project_name:test");
      expect(result).toBeUndefined();
    }).not.toThrow();
  });

  it("should return undefined when calling otel.addSpanParentToBaggage without OpenTelemetry", async () => {
    const { otel } = await import("../otel");

    const mockSpan = {
      attributes: { "braintrust.parent": "project_name:test" },
    } as any;

    const result = otel.addSpanParentToBaggage(mockSpan);
    expect(result).toBeUndefined();
  });

  it("should return undefined when calling otel.parentFromHeaders without OpenTelemetry", async () => {
    const { otel } = await import("../otel");

    const headers = {
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      baggage: "braintrust.parent=project_name:test",
    };

    const result = otel.parentFromHeaders(headers);
    expect(result).toBeUndefined();
  });
});
