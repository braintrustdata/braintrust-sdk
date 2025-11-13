/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BraintrustExporter } from "./exporter";

describe("BraintrustExporter", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should create BraintrustExporter with API key from environment", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    expect(() => {
      new BraintrustExporter();
    }).not.toThrow();
  });

  it("should create BraintrustExporter with API key from options", () => {
    expect(() => {
      new BraintrustExporter({
        apiKey: "test-api-key",
      });
    }).not.toThrow();
  });

  it("should throw error when no API key is provided", () => {
    delete process.env.BRAINTRUST_API_KEY;

    expect(() => {
      new BraintrustExporter();
    }).toThrow("Braintrust API key is required");
  });

  it("should use same options as BraintrustSpanProcessor", () => {
    const options = {
      apiKey: "test-api-key",
      apiUrl: "https://custom.api.url",
      parent: "project_name:test",
      filterAISpans: true,
      customFilter: (span: ReadableSpan) => span.name.includes("important"),
      headers: { "X-Custom": "value" },
    };

    expect(() => {
      new BraintrustExporter(options);
    }).not.toThrow();
  });

  it("should implement exporter interface", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const exporter = new BraintrustExporter();

    expect(typeof exporter.export).toBe("function");
    expect(typeof exporter.shutdown).toBe("function");
    expect(typeof exporter.forceFlush).toBe("function");
  });

  it("should export spans successfully", async () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const exporter = new BraintrustExporter();
    const mockSpans = [
      {
        name: "test-span",
        spanContext: () => ({ traceId: "test-trace", spanId: "test-span" }),
        attributes: {},
        parentSpanContext: undefined,
      },
    ] as unknown as ReadableSpan[];

    return new Promise<void>((resolve, reject) => {
      exporter.export(mockSpans, (result) => {
        try {
          expect(result.code).toBe(0); // SUCCESS
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it("should handle export errors gracefully", async () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const exporter = new BraintrustExporter();

    // Mock the processor to throw an error
    (exporter as any).processor = {
      onEnd: vi.fn().mockImplementation(() => {
        throw new Error("Test error");
      }),
      forceFlush: vi.fn(),
      shutdown: vi.fn(),
    };

    const mockSpans = [
      {
        name: "test-span",
        spanContext: () => ({ traceId: "test-trace", spanId: "test-span" }),
        attributes: {},
        parentSpanContext: undefined,
      },
    ] as unknown as ReadableSpan[];

    return new Promise<void>((resolve, reject) => {
      exporter.export(mockSpans, (result) => {
        try {
          expect(result.code).toBe(1); // FAILURE
          expect(result.error).toBeDefined();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it("should handle forceFlush errors gracefully", async () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const exporter = new BraintrustExporter();

    // Mock the processor to have forceFlush fail
    (exporter as any).processor = {
      onEnd: vi.fn(),
      forceFlush: vi.fn().mockRejectedValue(new Error("Flush error")),
      shutdown: vi.fn(),
    };

    const mockSpans = [
      {
        name: "test-span",
        spanContext: () => ({ traceId: "test-trace", spanId: "test-span" }),
        attributes: {},
        parentSpanContext: undefined,
      },
    ] as unknown as ReadableSpan[];

    return new Promise<void>((resolve, reject) => {
      exporter.export(mockSpans, (result) => {
        try {
          expect(result.code).toBe(1); // FAILURE
          expect(result.error).toBeDefined();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it("should forward shutdown to processor", async () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const exporter = new BraintrustExporter();
    const shutdownSpy = vi.spyOn((exporter as any).processor, "shutdown");

    await exporter.shutdown();

    expect(shutdownSpy).toHaveBeenCalled();
  });

  it("should forward forceFlush to processor", async () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const exporter = new BraintrustExporter();
    const flushSpy = vi.spyOn((exporter as any).processor, "forceFlush");

    await exporter.forceFlush();

    expect(flushSpy).toHaveBeenCalled();
  });

  it("should process multiple spans", async () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const exporter = new BraintrustExporter();
    const onEndSpy = vi.spyOn((exporter as any).processor, "onEnd");

    const mockSpans = [
      {
        name: "test-span-1",
        spanContext: () => ({ traceId: "test-trace", spanId: "test-span-1" }),
        attributes: {},
        parentSpanContext: undefined,
      },
      {
        name: "test-span-2",
        spanContext: () => ({ traceId: "test-trace", spanId: "test-span-2" }),
        attributes: {},
        parentSpanContext: undefined,
      },
    ] as unknown as ReadableSpan[];

    return new Promise<void>((resolve, reject) => {
      exporter.export(mockSpans, (result) => {
        try {
          expect(result.code).toBe(0); // SUCCESS
          expect(onEndSpy).toHaveBeenCalledTimes(2);
          expect(onEndSpy).toHaveBeenCalledWith(mockSpans[0]);
          expect(onEndSpy).toHaveBeenCalledWith(mockSpans[1]);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it("should support filtering options", () => {
    const exporter = new BraintrustExporter({
      apiKey: "test-api-key",
      filterAISpans: true,
      customFilter: (span: ReadableSpan) => span.name.includes("important"),
    });

    expect(exporter).toBeDefined();
  });

  it("should support all configuration options", () => {
    process.env.BRAINTRUST_API_KEY = "env-key";
    process.env.BRAINTRUST_PARENT = "env-parent";
    process.env.BRAINTRUST_API_URL = "https://env.url";

    const exporter = new BraintrustExporter({
      apiKey: "option-key",
      parent: "option-parent",
      apiUrl: "https://option.url",
      filterAISpans: false,
      headers: { "X-Custom": "value" },
    });

    expect(exporter).toBeDefined();
  });

  it("should use default parent when none is provided", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";
    delete process.env.BRAINTRUST_PARENT;

    const consoleSpy = vi.spyOn(console, "info");

    const exporter = new BraintrustExporter();

    expect(exporter).toBeDefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      "No parent specified, using default: project_name:default-otel-project. " +
        "Configure with BRAINTRUST_PARENT environment variable or parent parameter.",
    );

    consoleSpy.mockRestore();
  });

  it("proxy exporter should make OTEL v1 traces compatible with v2", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const exporter = new BraintrustExporter();
    const processor = (exporter as any).processor;
    const batchProcessor = (processor as any).processor;
    const proxiedExporter = (batchProcessor as any)._exporter;

    const mockExport = vi.fn();
    proxiedExporter.export = mockExport;

    const v1Span = {
      name: "gen_ai.completion",
      spanContext: () => ({ traceId: "trace-123", spanId: "span-456" }),
      parentSpanId: "parent-789",
      instrumentationLibrary: { name: "openai", version: "1.0.0" },
    } as any;

    proxiedExporter.export([v1Span], () => {});
    expect(mockExport).toHaveBeenCalledOnce();
    const [transformedSpans] = mockExport.mock.calls[0];

    expect(transformedSpans).toHaveLength(1);
    const transformedSpan = transformedSpans[0];

    // transformed span should have OTEL v2 fields
    const expectedV2Span = {
      ...v1Span,
      parentSpanContext: {
        spanId: v1Span.parentSpanId,
        traceId: v1Span.spanContext().traceId,
      },
      instrumentationScope: v1Span.instrumentationLibrary,
    } as any;
    expect(transformedSpan).toEqual(expectedV2Span);
  });
});
