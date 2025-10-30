import { describe, it, expect, vi, beforeAll } from "vitest";
import { _exportsForTestingOnly } from "./otel";

// This test file specifically tests the behavior when OpenTelemetry is not installed.
// It should run as part of our core / default test suite.

describe("OpenTelemetry not installed", () => {
  let otelInstalled = false;
  let originalConsoleWarn: any;

  beforeAll(() => {
    // Check if OpenTelemetry is actually installed - do this once for the whole suite
    try {
      _exportsForTestingOnly.ensureOtelLoadedSync();
      otelInstalled = true;
    } catch {
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

  it("should return undefined when calling otel.contextFromSpanExport without OpenTelemetry", async () => {
    if (otelInstalled) {
      // Skip this test if OpenTelemetry is installed
      return;
    }

    const { otel } = await import(".");

    const result = otel.contextFromSpanExport("some-export-string");
    expect(result).toBeUndefined();
  });

  it("should not error when calling otel.addParentToBaggage without OpenTelemetry", async () => {
    if (otelInstalled) {
      return;
    }

    const { otel } = await import(".");

    // Should not throw, just return a context (or undefined)
    expect(() => {
      const result = otel.addParentToBaggage("project_name:test");
      expect(result).toBeDefined();
    }).not.toThrow();
  });

  it("should return undefined when calling otel.addSpanParentToBaggage without OpenTelemetry", async () => {
    if (otelInstalled) {
      return;
    }

    const { otel } = await import(".");

    const mockSpan = {
      attributes: { "braintrust.parent": "project_name:test" },
    } as any;

    const result = otel.addSpanParentToBaggage(mockSpan);
    expect(result).toBeUndefined();
  });

  it("should return undefined when calling otel.parentFromHeaders without OpenTelemetry", async () => {
    if (otelInstalled) {
      return;
    }

    const { otel } = await import(".");

    const headers = {
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      baggage: "braintrust.parent=project_name:test",
    };

    const result = otel.parentFromHeaders(headers);
    expect(result).toBeUndefined();
  });
});
