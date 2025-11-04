import { describe, it, expect } from "vitest";

// This test file specifically tests the behavior when OpenTelemetry is not installed.
let otelInstalled = false;
try {
  await import("@opentelemetry/api");
  otelInstalled = true;
} catch {
  otelInstalled = false;
}

if (otelInstalled) {
  throw new Error(
    "OpenTelemetry IS installed, but this test requires it to be absent. ",
  );
}

describe("OpenTelemetry not installed", () => {
  it("should throw error when creating AISpanProcessor without OpenTelemetry", async () => {
    const { AISpanProcessor } = await import(".");

    expect(() => {
      new AISpanProcessor({} as any);
    }).toThrow("OpenTelemetry packages are not installed");
  });

  it("should throw error when creating BraintrustSpanProcessor without OpenTelemetry", async () => {
    const { BraintrustSpanProcessor } = await import(".");

    expect(() => {
      new BraintrustSpanProcessor({
        apiKey: "test-api-key",
      });
    }).toThrow("OpenTelemetry packages are not installed");
  });

  it("should return undefined when calling otel.contextFromSpanExport without OpenTelemetry", async () => {
    const { otel } = await import(".");

    const result = otel.contextFromSpanExport("some-export-string");
    expect(result).toBeUndefined();
  });

  it("should not error when calling otel.addParentToBaggage without OpenTelemetry", async () => {
    const { otel } = await import(".");

    // Should not throw, just return a context (or undefined)
    expect(() => {
      const result = otel.addParentToBaggage("project_name:test");
      expect(result).toBeUndefined();
    }).not.toThrow();
  });

  it("should return undefined when calling otel.addSpanParentToBaggage without OpenTelemetry", async () => {
    const { otel } = await import(".");

    const mockSpan = {
      attributes: { "braintrust.parent": "project_name:test" },
    } as any;

    const result = otel.addSpanParentToBaggage(mockSpan);
    expect(result).toBeUndefined();
  });

  it("should return undefined when calling otel.parentFromHeaders without OpenTelemetry", async () => {
    const { otel } = await import(".");

    const headers = {
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      baggage: "braintrust.parent=project_name:test",
    };

    const result = otel.parentFromHeaders(headers);
    expect(result).toBeUndefined();
  });
});
