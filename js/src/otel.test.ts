import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the required dependencies
const mockTrace = {
  getTracerProvider: vi.fn(),
};

const mockOTLPTraceExporter = vi.fn();
const mockBatchSpanProcessor = vi.fn();
const mockSimpleSpanProcessor = vi.fn();

vi.mock("@opentelemetry/api", () => ({
  trace: mockTrace,
}));

vi.mock("@opentelemetry/exporter-otlp-http", () => ({
  OTLPTraceExporter: mockOTLPTraceExporter,
}));

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BatchSpanProcessor: mockBatchSpanProcessor,
  SimpleSpanProcessor: mockSimpleSpanProcessor,
}));

describe("OpenTelemetry Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env.BRAINTRUST_API_KEY;
    delete process.env.BRAINTRUST_PARENT;
    delete process.env.BRAINTRUST_API_URL;
    delete process.env.BRAINTRUST_OTEL_ENABLE;
    delete process.env.BRAINTRUST_OTEL_ENABLE_LLM_FILTER;
  });

  describe("OtelExporter", () => {
    it("should create exporter with API key", async () => {
      const { OtelExporter } = await import("./otel");

      process.env.BRAINTRUST_API_KEY = "test-key";

      const exporter = new OtelExporter();

      expect(mockOTLPTraceExporter).toHaveBeenCalledWith({
        url: "https://api.braintrust.dev/otel/v1/traces",
        headers: {
          Authorization: "Bearer test-key",
        },
      });
    });

    it("should throw error without API key", async () => {
      const { OtelExporter } = await import("./otel");

      expect(() => new OtelExporter()).toThrow("API key is required");
    });

    it("should use custom URL and parent", async () => {
      const { OtelExporter } = await import("./otel");

      const exporter = new OtelExporter({
        url: "https://custom.example.com/otel/v1/traces",
        apiKey: "test-key",
        parent: "project:experiment",
        headers: { "x-custom": "value" },
      });

      expect(exporter.parent).toBe("project:experiment");
      expect(mockOTLPTraceExporter).toHaveBeenCalledWith({
        url: "https://custom.example.com/otel/v1/traces",
        apiKey: "test-key",
        parent: "project:experiment",
        headers: {
          Authorization: "Bearer test-key",
          "x-bt-parent": "project:experiment",
          "x-custom": "value",
        },
      });
    });
  });

  describe("LLMSpanProcessor", () => {
    it("should keep root spans", async () => {
      const { LLMSpanProcessor } = await import("./otel");

      const mockInnerProcessor = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn(),
        forceFlush: vi.fn(),
      };

      const processor = new LLMSpanProcessor(mockInnerProcessor);

      // Mock root span (no parent)
      const rootSpan = {
        name: "root_operation",
        parentSpanId: null,
        attributes: {},
      };

      processor.onEnd(rootSpan);

      expect(mockInnerProcessor.onEnd).toHaveBeenCalledWith(rootSpan);
    });

    it("should keep LLM spans by name", async () => {
      const { LLMSpanProcessor } = await import("./otel");

      const mockInnerProcessor = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn(),
        forceFlush: vi.fn(),
      };

      const processor = new LLMSpanProcessor(mockInnerProcessor);

      // Mock LLM span
      const llmSpan = {
        name: "gen_ai.completion",
        parentSpanId: "1234567890123456",
        attributes: {},
      };

      processor.onEnd(llmSpan);

      expect(mockInnerProcessor.onEnd).toHaveBeenCalledWith(llmSpan);
    });

    it("should keep spans with LLM attributes", async () => {
      const { LLMSpanProcessor } = await import("./otel");

      const mockInnerProcessor = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn(),
        forceFlush: vi.fn(),
      };

      const processor = new LLMSpanProcessor(mockInnerProcessor);

      // Mock span with LLM attributes
      const spanWithLLMAttrs = {
        name: "some_operation",
        parentSpanId: "1234567890123456",
        attributes: {
          "gen_ai.model": "gpt-4",
          regular_attr: "value",
        },
      };

      processor.onEnd(spanWithLLMAttrs);

      expect(mockInnerProcessor.onEnd).toHaveBeenCalledWith(spanWithLLMAttrs);
    });

    it("should drop non-LLM spans", async () => {
      const { LLMSpanProcessor } = await import("./otel");

      const mockInnerProcessor = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn(),
        forceFlush: vi.fn(),
      };

      const processor = new LLMSpanProcessor(mockInnerProcessor);

      // Mock non-LLM span
      const regularSpan = {
        name: "database_query",
        parentSpanId: "1234567890123456",
        attributes: {
          "db.system": "postgresql",
        },
      };

      processor.onEnd(regularSpan);

      expect(mockInnerProcessor.onEnd).not.toHaveBeenCalled();
    });

    it("should respect custom filter", async () => {
      const { LLMSpanProcessor } = await import("./otel");

      const mockInnerProcessor = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn(),
        forceFlush: vi.fn(),
      };

      const customFilter = vi.fn((span) => {
        return span.name.includes("important") ? true : null;
      });

      const processor = new LLMSpanProcessor(mockInnerProcessor, customFilter);

      // Mock span that would normally be dropped but custom filter keeps it
      const importantSpan = {
        name: "important_operation",
        parentSpanId: "1234567890123456",
        attributes: {},
      };

      processor.onEnd(importantSpan);

      expect(customFilter).toHaveBeenCalledWith(importantSpan);
      expect(mockInnerProcessor.onEnd).toHaveBeenCalledWith(importantSpan);
    });
  });

  describe("Processor", () => {
    it("should create processor with default settings", async () => {
      const { Processor } = await import("./otel");

      process.env.BRAINTRUST_API_KEY = "test-key";

      const processor = new Processor();

      expect(processor.exporter).toBeDefined();
      expect(processor.processor).toBeDefined();
    });

    it("should create processor with LLM filtering", async () => {
      const { Processor } = await import("./otel");

      process.env.BRAINTRUST_API_KEY = "test-key";

      const processor = new Processor({
        enableLlmFiltering: true,
      });

      expect(processor.exporter).toBeDefined();
      expect(processor.processor).toBeDefined();
    });
  });

  describe("OTEL_AVAILABLE", () => {
    it("should export OTEL_AVAILABLE", async () => {
      const { OTEL_AVAILABLE } = await import("./otel");

      expect(typeof OTEL_AVAILABLE).toBe("boolean");
    });
  });
});
