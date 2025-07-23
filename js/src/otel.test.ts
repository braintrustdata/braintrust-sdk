import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { trace, context, Tracer } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { AISpanProcessor, BraintrustSpanProcessor } from ".";

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

    provider = new BasicTracerProvider({
      spanProcessors: [filterProcessor],
    });

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
    const regularSpan = tracer.startSpan("database_query", {}, parentContext);

    genAiSpan.end();
    braintrustSpan.end();
    llmSpan.end();
    aiSpan.end();
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
    const customProvider = new BasicTracerProvider({
      spanProcessors: [customFilterProcessor],
    });
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
    const customProvider = new BasicTracerProvider({
      spanProcessors: [customFilterProcessor],
    });
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
    const customProvider = new BasicTracerProvider({
      spanProcessors: [customFilterProcessor],
    });
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
