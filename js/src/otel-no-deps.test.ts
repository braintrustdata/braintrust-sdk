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

  it("should not have OTEL exports in main SDK anymore", async () => {
    const braintrust = await import(".");
    
    // These should no longer be exported from the main SDK
    expect((braintrust as any).AISpanProcessor).toBeUndefined();
    expect((braintrust as any).BraintrustSpanProcessor).toBeUndefined();
    expect((braintrust as any).BraintrustExporter).toBeUndefined();
    expect((braintrust as any).otel).toBeUndefined();
  });
});
