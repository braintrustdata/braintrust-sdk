/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { trace, context, Tracer, propagation } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
  CompositePropagator,
} from "@opentelemetry/core";
import {
  AISpanProcessor,
  BraintrustSpanProcessor,
  BraintrustExporter,
  addSpanParentToBaggage,
  addParentToBaggage,
  parentFromHeaders,
} from "./otel";

describe("AISpanProcessor", () => {
  let memoryExporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let filterProcessor: AISpanProcessor;
  let tracer: Tracer;
  let baseProcessor: SimpleSpanProcessor;

  beforeEach(() => {
    memoryExporter = new InMemorySpanExporter();

    // Create processor with our filtering logic
    baseProcessor = new SimpleSpanProcessor(memoryExporter);
    filterProcessor = new AISpanProcessor(baseProcessor);

    provider = new BasicTracerProvider();
    provider.addSpanProcessor(filterProcessor);

    // Don't set global tracer provider - use local one instead
    tracer = provider.getTracer("test_tracer");
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it("should keep root spans", () => {
    const span = tracer.startSpan("root_operation");
    span.end();

    const spans = memoryExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("root_operation");
  });

  it("should keep spans with filtered name prefixes", async () => {
    const rootSpan = tracer.startSpan("root");

    const parentContext = trace.setSpanContext(
      context.active(),
      rootSpan.spanContext(),
    );
    const genAiSpan = tracer.startSpan("gen_ai.completion", {}, parentContext);
    const braintrustSpan = tracer.startSpan(
      "braintrust.eval",
      {},
      parentContext,
    );
    const llmSpan = tracer.startSpan("llm.generate", {}, parentContext);
    const aiSpan = tracer.startSpan("ai.model_call", {}, parentContext);
    const traceloopSpan = tracer.startSpan(
      "traceloop.agent",
      {},
      parentContext,
    );
    const regularSpan = tracer.startSpan("database_query", {}, parentContext);

    genAiSpan.end();
    braintrustSpan.end();
    llmSpan.end();
    aiSpan.end();
    traceloopSpan.end();
    regularSpan.end();
    rootSpan.end();

    // Force flush to ensure spans are processed
    await provider.forceFlush();

    const spans = memoryExporter.getFinishedSpans();
    const spanNames = spans.map((s) => s.name);

    expect(spanNames).toContain("root");
    expect(spanNames).toContain("gen_ai.completion");
    expect(spanNames).toContain("braintrust.eval");
    expect(spanNames).toContain("llm.generate");
    expect(spanNames).toContain("ai.model_call");
    expect(spanNames).toContain("traceloop.agent");
    // database_query should be filtered out as it doesn't match filtered prefixes
    expect(spanNames).not.toContain("database_query");
  });

  it("should keep spans with filtered attribute prefixes", async () => {
    const rootSpan = tracer.startSpan("root");

    const parentContext = trace.setSpanContext(
      context.active(),
      rootSpan.spanContext(),
    );
    const genAiAttrSpan = tracer.startSpan(
      "gen_ai_attr_operation",
      {},
      parentContext,
    );
    genAiAttrSpan.setAttributes({ "gen_ai.model": "gpt-4" });

    const braintrustAttrSpan = tracer.startSpan(
      "braintrust_attr_operation",
      {},
      parentContext,
    );
    braintrustAttrSpan.setAttributes({ "braintrust.dataset": "test-data" });

    const llmAttrSpan = tracer.startSpan(
      "llm_attr_operation",
      {},
      parentContext,
    );
    llmAttrSpan.setAttributes({ "llm.tokens": 100 });

    const aiAttrSpan = tracer.startSpan("ai_attr_operation", {}, parentContext);
    aiAttrSpan.setAttributes({ "ai.temperature": 0.7 });

    const traceloopAttrSpan = tracer.startSpan(
      "traceloop_attr_operation",
      {},
      parentContext,
    );
    traceloopAttrSpan.setAttributes({ "traceloop.agent_id": "agent-123" });

    const regularSpan = tracer.startSpan(
      "regular_operation",
      {},
      parentContext,
    );
    regularSpan.setAttributes({ "database.connection": "postgres" });

    genAiAttrSpan.end();
    braintrustAttrSpan.end();
    llmAttrSpan.end();
    aiAttrSpan.end();
    traceloopAttrSpan.end();
    regularSpan.end();
    rootSpan.end();

    // Force flush to ensure spans are processed
    await provider.forceFlush();

    const spans = memoryExporter.getFinishedSpans();
    const spanNames = spans.map((s) => s.name);

    expect(spanNames).toContain("root");
    expect(spanNames).toContain("gen_ai_attr_operation");
    expect(spanNames).toContain("braintrust_attr_operation");
    expect(spanNames).toContain("llm_attr_operation");
    expect(spanNames).toContain("ai_attr_operation");
    expect(spanNames).toContain("traceloop_attr_operation");
    expect(spanNames).not.toContain("regular_operation");
  });

  it("should support custom filter that keeps spans", () => {
    const customFilter = (span: ReadableSpan) => {
      if (span.name === "custom_keep") {
        return true;
      }
      return null; // Don't influence decision
    };

    // Create new processor with custom filter
    const customMemoryExporter = new InMemorySpanExporter();
    const customFilterProcessor = new AISpanProcessor(
      new SimpleSpanProcessor(customMemoryExporter),
      customFilter,
    );
    const customProvider = new BasicTracerProvider();
    customProvider.addSpanProcessor(customFilterProcessor);

    const customTracer = customProvider.getTracer("custom_test");

    const rootSpan = customTracer.startSpan("root");

    const parentContext = trace.setSpanContext(
      context.active(),
      rootSpan.spanContext(),
    );
    const keepSpan = customTracer.startSpan("custom_keep", {}, parentContext);
    const regularSpan = customTracer.startSpan(
      "regular_operation",
      {},
      parentContext,
    );

    keepSpan.end();
    regularSpan.end();
    rootSpan.end();

    const spans = customMemoryExporter.getFinishedSpans();
    const spanNames = spans.map((s) => s.name);

    expect(spanNames).toContain("root");
    expect(spanNames).toContain("custom_keep"); // kept by custom filter
    expect(spanNames).not.toContain("regular_operation"); // dropped by default logic

    customProvider.shutdown();
  });

  it("should support custom filter that drops spans", () => {
    const customFilter = (span: ReadableSpan) => {
      if (span.name === "gen_ai.drop_this") {
        return false;
      }
      return null; // Don't influence decision
    };

    // Create new processor with custom filter
    const customMemoryExporter = new InMemorySpanExporter();
    const customFilterProcessor = new AISpanProcessor(
      new SimpleSpanProcessor(customMemoryExporter),
      customFilter,
    );
    const customProvider = new BasicTracerProvider();
    customProvider.addSpanProcessor(customFilterProcessor);

    const customTracer = customProvider.getTracer("custom_test");

    const rootSpan = customTracer.startSpan("root");

    const parentContext = trace.setSpanContext(
      context.active(),
      rootSpan.spanContext(),
    );
    const dropSpan = customTracer.startSpan(
      "gen_ai.drop_this",
      {},
      parentContext,
    );
    const keepSpan = customTracer.startSpan(
      "gen_ai.keep_this",
      {},
      parentContext,
    );

    dropSpan.end();
    keepSpan.end();
    rootSpan.end();

    const spans = customMemoryExporter.getFinishedSpans();
    const spanNames = spans.map((s) => s.name);

    expect(spanNames).toContain("root");
    expect(spanNames).not.toContain("gen_ai.drop_this"); // dropped by custom filter
    expect(spanNames).toContain("gen_ai.keep_this"); // kept by default filter logic

    customProvider.shutdown();
  });

  it("should support custom filter that defers to default logic", () => {
    const customFilter = (span: ReadableSpan) => {
      return null; // Always defer to default logic
    };

    // Create new processor with custom filter
    const customMemoryExporter = new InMemorySpanExporter();
    const customFilterProcessor = new AISpanProcessor(
      new SimpleSpanProcessor(customMemoryExporter),
      customFilter,
    );
    const customProvider = new BasicTracerProvider();
    customProvider.addSpanProcessor(customFilterProcessor);

    const customTracer = customProvider.getTracer("custom_test");

    const rootSpan = customTracer.startSpan("root");

    const parentContext = trace.setSpanContext(
      context.active(),
      rootSpan.spanContext(),
    );
    const llmSpan = customTracer.startSpan(
      "gen_ai.completion",
      {},
      parentContext,
    );
    const regularSpan = customTracer.startSpan(
      "regular_operation",
      {},
      parentContext,
    );

    llmSpan.end();
    regularSpan.end();
    rootSpan.end();

    const spans = customMemoryExporter.getFinishedSpans();
    const spanNames = spans.map((s) => s.name);

    expect(spanNames).toContain("root");
    expect(spanNames).toContain("gen_ai.completion"); // kept by default filter logic
    expect(spanNames).not.toContain("regular_operation"); // dropped by default logic

    customProvider.shutdown();
  });

  describe("cross-version span filtering", () => {
    it.each([
      // Root spans (no parent) - should always be kept
      {
        name: "v1 root span",
        spanName: "v1-root-span",
        parentSpanContext: undefined,
        parentSpanId: undefined,
        attributes: {},
        expected: true,
        reason: "root spans are always kept",
      },
      {
        name: "v2 root span",
        spanName: "v2-root-span",
        parentSpanContext: undefined,
        parentSpanId: undefined,
        attributes: {},
        expected: true,
        reason: "root spans are always kept",
      },

      // Child spans without AI prefixes - should be dropped
      {
        name: "v1 child span (no AI prefix)",
        spanName: "database.query",
        parentSpanContext: undefined,
        parentSpanId: "parent-123",
        attributes: {},
        expected: false,
        reason: "child spans without AI prefixes are dropped",
      },
      {
        name: "v2 child span (no AI prefix)",
        spanName: "http.request",
        parentSpanContext: { spanId: "parent-456", traceId: "trace-789" },
        parentSpanId: undefined,
        attributes: {},
        expected: false,
        reason: "child spans without AI prefixes are dropped",
      },
      {
        name: "mixed child span (no AI prefix)",
        spanName: "regular.operation",
        parentSpanContext: { spanId: "parent-mixed", traceId: "trace-mixed" },
        parentSpanId: "parent-mixed-id",
        attributes: {},
        expected: false,
        reason: "child spans without AI prefixes are dropped",
      },

      // Child spans with AI prefixes - should be kept
      {
        name: "v1 child span with gen_ai prefix",
        spanName: "gen_ai.completion",
        parentSpanContext: undefined,
        parentSpanId: "parent-123",
        attributes: {},
        expected: true,
        reason: "child spans with AI prefixes are kept",
      },
      {
        name: "v2 child span with llm prefix",
        spanName: "llm.generate",
        parentSpanContext: { spanId: "parent-456", traceId: "trace-789" },
        parentSpanId: undefined,
        attributes: {},
        expected: true,
        reason: "child spans with AI prefixes are kept",
      },
      {
        name: "v1 child span with braintrust prefix",
        spanName: "braintrust.eval",
        parentSpanContext: undefined,
        parentSpanId: "parent-123",
        attributes: {},
        expected: true,
        reason: "child spans with AI prefixes are kept",
      },
      {
        name: "v2 child span with ai prefix",
        spanName: "ai.model_call",
        parentSpanContext: { spanId: "parent-456", traceId: "trace-789" },
        parentSpanId: undefined,
        attributes: {},
        expected: true,
        reason: "child spans with AI prefixes are kept",
      },
      {
        name: "mixed child span with traceloop prefix",
        spanName: "traceloop.agent",
        parentSpanContext: { spanId: "parent-mixed", traceId: "trace-mixed" },
        parentSpanId: "parent-mixed-id",
        attributes: {},
        expected: true,
        reason: "child spans with AI prefixes are kept",
      },

      // Child spans with AI attribute prefixes - should be kept
      {
        name: "v1 child span with gen_ai attribute",
        spanName: "some.operation",
        parentSpanContext: undefined,
        parentSpanId: "parent-123",
        attributes: { "gen_ai.model": "gpt-4" },
        expected: true,
        reason: "child spans with AI attribute prefixes are kept",
      },
      {
        name: "v2 child span with llm attribute",
        spanName: "some.operation",
        parentSpanContext: { spanId: "parent-456", traceId: "trace-789" },
        parentSpanId: undefined,
        attributes: { "llm.temperature": 0.7 },
        expected: true,
        reason: "child spans with AI attribute prefixes are kept",
      },
    ])(
      "should filter spans correctly across OTel versions: $name",
      ({
        spanName,
        parentSpanContext,
        parentSpanId,
        attributes,
        expected,
        reason,
      }) => {
        const filterProcessor = new AISpanProcessor({} as any);

        const mockSpan = {
          name: spanName,
          attributes,
          parentSpanContext,
          parentSpanId,
          spanContext: () => ({
            spanId: "test-span-id",
            traceId: "test-trace-id",
          }),
          kind: 0,
          startTime: [Date.now(), 0],
          endTime: [Date.now(), 0],
          status: { code: 0 },
          ended: true,
          duration: [0, 1000000],
          events: [],
          links: [],
          resource: {} as any,
          instrumentationLibrary: {} as any,
          instrumentationScope: {} as any,
          droppedAttributesCount: 0,
          droppedEventsCount: 0,
          droppedLinksCount: 0,
        } as unknown as ReadableSpan;

        const result = (filterProcessor as any).shouldKeepFilteredSpan(
          mockSpan,
        );

        expect(result).toBe(expected);
      },
    );
  });
});

describe("BraintrustSpanProcessor", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should create BraintrustSpanProcessor with API key from environment", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    expect(() => {
      new BraintrustSpanProcessor();
    }).not.toThrow();
  });

  it("should create BraintrustSpanProcessor with API key from options", () => {
    expect(() => {
      new BraintrustSpanProcessor({
        apiKey: "test-api-key",
      });
    }).not.toThrow();
  });

  it("should throw error when no API key is provided", () => {
    delete process.env.BRAINTRUST_API_KEY;

    expect(() => {
      new BraintrustSpanProcessor();
    }).toThrow("Braintrust API key is required");
  });

  it("should use default API URL when not provided", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const processor = new BraintrustSpanProcessor();
    expect(processor).toBeDefined();
  });

  it("should use custom API URL when provided", () => {
    const processor = new BraintrustSpanProcessor({
      apiKey: "test-api-key",
      apiUrl: "https://custom.api.url",
    });
    expect(processor).toBeDefined();
  });

  it("should support custom headers", () => {
    const processor = new BraintrustSpanProcessor({
      apiKey: "test-api-key",
      headers: {
        "X-Custom-Header": "custom-value",
      },
    });
    expect(processor).toBeDefined();
  });

  it("should support custom filter function", () => {
    const customFilter = (span: ReadableSpan) => {
      return span.name.includes("important");
    };

    const processor = new BraintrustSpanProcessor({
      apiKey: "test-api-key",
      customFilter,
    });
    expect(processor).toBeDefined();
  });

  it("should support parent option", () => {
    const processor = new BraintrustSpanProcessor({
      apiKey: "test-api-key",
      parent: "project_name:otel_examples",
    });
    expect(processor).toBeDefined();
  });

  it("should use BRAINTRUST_PARENT environment variable", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";
    process.env.BRAINTRUST_PARENT = "project_name:env_examples";

    const processor = new BraintrustSpanProcessor();
    expect(processor).toBeDefined();
  });

  it("should use BRAINTRUST_API_URL environment variable", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";
    process.env.BRAINTRUST_API_URL = "https://custom.env.url";

    const processor = new BraintrustSpanProcessor();
    expect(processor).toBeDefined();
  });

  it("should prioritize options over environment variables", () => {
    process.env.BRAINTRUST_API_KEY = "env-api-key";
    process.env.BRAINTRUST_PARENT = "env-parent";
    process.env.BRAINTRUST_API_URL = "https://env.url";

    const processor = new BraintrustSpanProcessor({
      apiKey: "option-api-key",
      parent: "option-parent",
      apiUrl: "https://option.url",
    });
    expect(processor).toBeDefined();
  });

  it("should disable filtering by default", () => {
    const processor = new BraintrustSpanProcessor({
      apiKey: "test-api-key",
    });
    expect(processor).toBeDefined();
  });

  it("should enable filtering when filterAISpans is true", () => {
    const processor = new BraintrustSpanProcessor({
      apiKey: "test-api-key",
      filterAISpans: true,
    });
    expect(processor).toBeDefined();
  });

  it("should disable filtering when filterAISpans is false", () => {
    const processor = new BraintrustSpanProcessor({
      apiKey: "test-api-key",
      filterAISpans: false,
    });
    expect(processor).toBeDefined();
  });

  it("should implement SpanProcessor interface", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const processor = new BraintrustSpanProcessor();

    expect(typeof processor.onStart).toBe("function");
    expect(typeof processor.onEnd).toBe("function");
    expect(typeof processor.shutdown).toBe("function");
    expect(typeof processor.forceFlush).toBe("function");
  });

  it("should forward span lifecycle methods to AISpanProcessor", async () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";

    const processor = new BraintrustSpanProcessor();

    // Create a mock span
    const mockSpan = {
      spanContext: () => ({ traceId: "test-trace", spanId: "test-span" }),
      end: vi.fn(),
      setAttributes: vi.fn(),
      name: "test-span",
      attributes: {},
      parentSpanContext: undefined,
    } as any;

    // Test onStart
    expect(() => {
      processor.onStart(mockSpan, context.active());
    }).not.toThrow();

    // Test onEnd
    expect(() => {
      processor.onEnd(mockSpan);
    }).not.toThrow();

    // Test shutdown and forceFlush
    await expect(processor.shutdown()).resolves.toBeUndefined();
    await expect(processor.forceFlush()).resolves.toBeUndefined();
  });

  it("should use default parent when none is provided", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";
    delete process.env.BRAINTRUST_PARENT;

    const consoleSpy = vi.spyOn(console, "info");

    const processor = new BraintrustSpanProcessor();

    expect(processor).toBeDefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      "No parent specified, using default: project_name:default-otel-project. " +
        "Configure with BRAINTRUST_PARENT environment variable or parent parameter.",
    );

    consoleSpy.mockRestore();
  });

  it("should not use default parent when BRAINTRUST_PARENT is set", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";
    process.env.BRAINTRUST_PARENT = "my-project:my-experiment";

    const consoleSpy = vi.spyOn(console, "info");

    const processor = new BraintrustSpanProcessor();

    expect(processor).toBeDefined();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should not use default parent when parent option is provided", () => {
    process.env.BRAINTRUST_API_KEY = "test-api-key";
    delete process.env.BRAINTRUST_PARENT;

    const consoleSpy = vi.spyOn(console, "info");

    const processor = new BraintrustSpanProcessor({
      parent: "option-project:option-experiment",
    });

    expect(processor).toBeDefined();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

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

describe("otel namespace helpers", () => {
  let provider: BasicTracerProvider;
  let tracer: Tracer;

  beforeEach(() => {
    provider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(provider);
    tracer = trace.getTracer("test-tracer");

    // Set up W3C propagators for header parsing tests
    const compositePropagator = new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    });
    propagation.setGlobalPropagator(compositePropagator);
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  describe("addParentToBaggage", () => {
    it("should add braintrust.parent to baggage", () => {
      const parent = "project_name:test:span_id:abc123:row_id:xyz789";
      const ctx = addParentToBaggage(parent);

      const baggage = propagation.getBaggage(ctx);
      expect(baggage?.getEntry("braintrust.parent")?.value).toBe(parent);
    });

    it("should use provided context", () => {
      const parent = "project_name:test:span_id:abc123:row_id:xyz789";
      const initialCtx = context.active();
      const resultCtx = addParentToBaggage(parent, initialCtx);

      const baggage = propagation.getBaggage(resultCtx);
      expect(baggage?.getEntry("braintrust.parent")?.value).toBe(parent);
    });
  });

  describe("addSpanParentToBaggage", () => {
    it("should extract braintrust.parent from span attribute and add to baggage", () => {
      const span = tracer.startSpan("test-span");
      const parent = "project_name:test:span_id:abc123:row_id:xyz789";
      span.setAttribute("braintrust.parent", parent);

      const ctx = addSpanParentToBaggage(span);
      expect(ctx).toBeDefined();

      const baggage = propagation.getBaggage(ctx!);
      expect(baggage?.getEntry("braintrust.parent")?.value).toBe(parent);

      span.end();
    });

    it("should return undefined when span has no braintrust.parent attribute", () => {
      const span = tracer.startSpan("test-span");

      const ctx = addSpanParentToBaggage(span);
      expect(ctx).toBeUndefined();

      span.end();
    });

    it("should use provided context", () => {
      const span = tracer.startSpan("test-span");
      const parent = "project_name:test:span_id:abc123:row_id:xyz789";
      span.setAttribute("braintrust.parent", parent);

      const initialCtx = context.active();
      const ctx = addSpanParentToBaggage(span, initialCtx);
      expect(ctx).toBeDefined();

      const baggage = propagation.getBaggage(ctx!);
      expect(baggage?.getEntry("braintrust.parent")?.value).toBe(parent);

      span.end();
    });
  });

  describe("parentFromHeaders", () => {
    describe("valid inputs", () => {
      it("should extract parent from headers with valid traceparent and braintrust.parent baggage", () => {
        const headers = {
          traceparent:
            "00-12345678901234567890123456789012-1234567890123456-01",
          baggage: "braintrust.parent=project_name:test",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeDefined();
        // Parent string is base64-encoded SpanComponentsV4
        expect(typeof parent).toBe("string");
        expect(parent!.length).toBeGreaterThan(0);
      });

      it("should extract parent with project_id", () => {
        const headers = {
          traceparent:
            "00-abcdef12345678901234567890123456-fedcba9876543210-01",
          baggage: "braintrust.parent=project_id:my-project-id",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeDefined();
        expect(typeof parent).toBe("string");
        expect(parent!.length).toBeGreaterThan(0);
      });

      it("should extract parent with experiment_id", () => {
        const headers = {
          traceparent:
            "00-11111111111111111111111111111111-2222222222222222-01",
          baggage: "braintrust.parent=experiment_id:my-experiment-id",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeDefined();
        expect(typeof parent).toBe("string");
        expect(parent!.length).toBeGreaterThan(0);
      });
    });

    describe("invalid inputs", () => {
      it("should return undefined when traceparent is missing", () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        const headers = {
          baggage: "braintrust.parent=project_name:test",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeUndefined();
        expect(consoleSpy).toHaveBeenCalledWith(
          "parentFromHeaders: No valid span context in headers",
        );

        consoleSpy.mockRestore();
      });

      it("should return undefined when baggage is missing", () => {
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        const headers = {
          traceparent:
            "00-12345678901234567890123456789012-1234567890123456-01",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeUndefined();
        expect(consoleSpy).toHaveBeenCalled();
        expect(consoleSpy.mock.calls[0][0]).toContain(
          "braintrust.parent not found",
        );

        consoleSpy.mockRestore();
      });

      it("should return undefined when braintrust.parent is missing from baggage", () => {
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        const headers = {
          traceparent:
            "00-12345678901234567890123456789012-1234567890123456-01",
          baggage: "foo=bar,baz=qux",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeUndefined();
        expect(consoleSpy).toHaveBeenCalled();
        expect(consoleSpy.mock.calls[0][0]).toContain(
          "braintrust.parent not found",
        );

        consoleSpy.mockRestore();
      });

      it("should return undefined when traceparent format is invalid", () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        const headers = {
          traceparent: "invalid-traceparent",
          baggage: "braintrust.parent=project_name:test",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeUndefined();
        expect(consoleSpy).toHaveBeenCalledWith(
          "parentFromHeaders: No valid span context in headers",
        );

        consoleSpy.mockRestore();
      });

      it("should return undefined when trace_id is all zeros", () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        const headers = {
          traceparent:
            "00-00000000000000000000000000000000-1234567890123456-01",
          baggage: "braintrust.parent=project_name:test",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeUndefined();
        // OTEL's extract() validates and rejects invalid trace_id
        expect(consoleSpy).toHaveBeenCalledWith(
          "parentFromHeaders: No valid span context in headers",
        );

        consoleSpy.mockRestore();
      });

      it("should return undefined when span_id is all zeros", () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        const headers = {
          traceparent:
            "00-12345678901234567890123456789012-0000000000000000-01",
          baggage: "braintrust.parent=project_name:test",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeUndefined();
        // OTEL's extract() validates and rejects invalid span_id
        expect(consoleSpy).toHaveBeenCalledWith(
          "parentFromHeaders: No valid span context in headers",
        );

        consoleSpy.mockRestore();
      });

      it("should return undefined when braintrust.parent format is invalid", () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        const headers = {
          traceparent:
            "00-12345678901234567890123456789012-1234567890123456-01",
          baggage: "braintrust.parent=invalid",
        };

        const parent = parentFromHeaders(headers);
        expect(parent).toBeUndefined();
        // Should reach our validation if span context is valid, otherwise OTEL rejects it
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });
  });
});
