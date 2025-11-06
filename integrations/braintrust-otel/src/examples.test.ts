import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as api from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
  CompositePropagator,
} from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { _exportsForTestingOnly } from "braintrust";

describe("OTEL Examples Validation", () => {
  let provider: BasicTracerProvider;
  let exporter: InMemorySpanExporter;
  let tracer: api.Tracer;
  let otelContextManager: AsyncLocalStorageContextManager;

  beforeAll(async () => {
    // Set up test API key to avoid login errors
    await _exportsForTestingOnly.simulateLoginForTests();
    // Set up OTEL context manager for context propagation
    otelContextManager = new AsyncLocalStorageContextManager();
    otelContextManager.enable();
    api.context.setGlobalContextManager(otelContextManager);

    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    api.trace.setGlobalTracerProvider(provider);
    tracer = api.trace.getTracer("example-test");

    // Set up W3C propagators for baggage tests
    const compositePropagator = new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    });
    api.propagation.setGlobalPropagator(compositePropagator);
  });

  afterAll(async () => {
    await provider.shutdown();
    otelContextManager.disable();
  });

  describe("Package imports", () => {
    it("should import BraintrustSpanProcessor from @braintrust/otel", async () => {
      const { BraintrustSpanProcessor } = await import("./index");
      expect(BraintrustSpanProcessor).toBeDefined();
      expect(BraintrustSpanProcessor).toBeTypeOf("function");
    });

    it("should import AISpanProcessor from @braintrust/otel", async () => {
      const { AISpanProcessor } = await import("./index");
      expect(AISpanProcessor).toBeDefined();
      expect(AISpanProcessor).toBeTypeOf("function");
    });

    it("should import BraintrustExporter from @braintrust/otel", async () => {
      const { BraintrustExporter } = await import("./index");
      expect(BraintrustExporter).toBeDefined();
      expect(BraintrustExporter).toBeTypeOf("function");
    });

    it("should import OtelContextManager from @braintrust/otel", async () => {
      const { OtelContextManager } = await import("./index");
      expect(OtelContextManager).toBeDefined();
      expect(OtelContextManager).toBeTypeOf("function");
    });

    it("should import otel utilities from @braintrust/otel", async () => {
      const { otel } = await import("./index");
      expect(otel).toBeDefined();
      expect(otel.contextFromSpanExport).toBeTypeOf("function");
      expect(otel.addParentToBaggage).toBeTypeOf("function");
      expect(otel.addSpanParentToBaggage).toBeTypeOf("function");
      expect(otel.parentFromHeaders).toBeTypeOf("function");
      expect(otel.getBraintrustParent).toBeTypeOf("function");
    });

    it("should NOT import OTEL components from braintrust", async () => {
      const braintrust = await import("braintrust");
      expect((braintrust as any).BraintrustSpanProcessor).toBeUndefined();
      expect((braintrust as any).AISpanProcessor).toBeUndefined();
      expect((braintrust as any).BraintrustExporter).toBeUndefined();
      expect((braintrust as any).otel).toBeUndefined();
    });
  });

  describe("NodeSDK Example Pattern", () => {
    it("should instantiate BraintrustSpanProcessor", async () => {
      const { BraintrustSpanProcessor } = await import("./index");

      const processor = new BraintrustSpanProcessor({
        apiKey: "test-api-key",
        parent: "project_name:test",
      });

      expect(processor).toBeDefined();
      expect(processor.onStart).toBeTypeOf("function");
      expect(processor.onEnd).toBeTypeOf("function");

      await processor.shutdown();
    });

    it("should work with BasicTracerProvider", async () => {
      const { BraintrustSpanProcessor } = await import("./index");

      const testProvider = new BasicTracerProvider();
      const processor = new BraintrustSpanProcessor({
        apiKey: "test-api-key",
        parent: "project_name:test",
      });

      testProvider.addSpanProcessor(processor as any);

      expect(testProvider.getTracer("test")).toBeDefined();

      await testProvider.shutdown();
    });
  });

  describe("Custom OTEL Example Pattern", () => {
    it("should support AI span filtering", async () => {
      const { BraintrustSpanProcessor } = await import("./index");

      const processor = new BraintrustSpanProcessor({
        apiKey: "test-api-key",
        parent: "project_name:test",
        filterAISpans: true,
      });

      expect(processor).toBeDefined();
      await processor.shutdown();
    });

    it("should support custom filter functions", async () => {
      const { BraintrustSpanProcessor } = await import("./index");

      const customFilter = (span: any) => {
        return span.name.includes("important");
      };

      const processor = new BraintrustSpanProcessor({
        apiKey: "test-api-key",
        parent: "project_name:test",
        filterAISpans: true,
        customFilter,
      });

      expect(processor).toBeDefined();
      await processor.shutdown();
    });
  });

  describe("Distributed Tracing Example Pattern", () => {
    it("should convert BT span export to OTEL context", async () => {
      const { otel } = await import("./index");
      const { initLogger } = await import("braintrust");

      const logger = initLogger({
        projectName: "distributed-test",
        projectId: "test-project-id",
      });

      const btSpan = logger.startSpan({ name: "service-a" });
      const exportStr = await btSpan.export();
      btSpan.end();

      const ctx = otel.contextFromSpanExport(exportStr);
      expect(ctx).toBeDefined();

      // Verify we can use the context
      await api.context.with(ctx, async () => {
        const activeSpan = api.trace.getActiveSpan();
        expect(activeSpan).toBeDefined();
      });
    });

    it("should add parent to baggage", async () => {
      const { otel } = await import("./index");

      const parentValue = "project_name:test-project";
      const ctx = otel.addParentToBaggage(parentValue);

      expect(ctx).toBeDefined();

      // Verify baggage contains the parent
      const headers: Record<string, string> = {};
      api.propagation.inject(ctx, headers);

      expect(headers.baggage).toBeDefined();
      expect(headers.baggage).toContain("braintrust.parent");
      // Baggage headers are URL-encoded, so check for both encoded and raw versions
      const encodedValue = encodeURIComponent(parentValue);
      expect(
        headers.baggage.includes(parentValue) ||
          headers.baggage.includes(encodedValue),
      ).toBe(true);
    });

    it("should extract parent from headers", async () => {
      const { otel } = await import("./index");

      // Create headers with traceparent and baggage
      const headers = {
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        baggage: "braintrust.parent=project_name:test-project",
      };

      const parent = otel.parentFromHeaders(headers);
      expect(parent).toBeDefined();
      expect(typeof parent).toBe("string");
    });

    it("should handle full round-trip: BT → OTEL → BT", async () => {
      const { otel, OtelContextManager } = await import("./index");
      const { initLogger, setContextManager } = await import("braintrust");

      // Set up OTEL context manager
      setContextManager(new OtelContextManager());

      const logger = initLogger({
        projectName: "roundtrip-test",
        projectId: "test-project-id",
      });

      // Service A: BT span
      const spanA = logger.startSpan({ name: "service-a" });
      const exportStr = await spanA.export();
      spanA.end();

      // Service B: OTEL span
      const ctxB = otel.contextFromSpanExport(exportStr);
      let spanBId: string | undefined;

      await api.context.with(ctxB, async () => {
        await tracer.startActiveSpan("service-b", async (spanB) => {
          spanBId = spanB.spanContext().spanId;

          // Add parent to baggage
          otel.addSpanParentToBaggage(spanB as any);

          // Export headers
          const headers: Record<string, string> = {};
          api.propagation.inject(api.context.active(), headers);

          // Service C: BT span from headers
          const parentC = otel.parentFromHeaders(headers);
          if (parentC) {
            const spanC = logger.startSpan({
              name: "service-c",
              parent: parentC,
            });

            expect(spanC).toBeDefined();
            spanC.end();
          }

          spanB.end();
        });
      });

      expect(spanBId).toBeDefined();
    });
  });

  describe("Exporter Example Pattern", () => {
    it("should work with BraintrustExporter", async () => {
      const { BraintrustExporter } = await import("./index");

      const exporter = new BraintrustExporter({
        apiKey: "test-api-key",
        parent: "project_name:test",
      });

      expect(exporter).toBeDefined();
      expect(exporter.export).toBeTypeOf("function");
      expect(exporter.shutdown).toBeTypeOf("function");

      await exporter.shutdown();
    });

    it("should integrate with BatchSpanProcessor", async () => {
      const { BraintrustExporter } = await import("./index");

      const exporter = new BraintrustExporter({
        apiKey: "test-api-key",
        parent: "project_name:test",
        filterAISpans: true,
      });

      const processor = new BatchSpanProcessor(exporter as any);
      const testProvider = new BasicTracerProvider();
      testProvider.addSpanProcessor(processor);

      expect(testProvider.getTracer("test")).toBeDefined();

      await testProvider.shutdown();
    });
  });

  describe("Error Handling", () => {
    it("should throw clear error when API key missing", async () => {
      const { BraintrustSpanProcessor } = await import("./index");

      expect(() => {
        new BraintrustSpanProcessor({
          // No API key
          parent: "project_name:test",
        });
      }).toThrow(/API key is required/);
    });

    it("should provide default parent if not specified", async () => {
      const { BraintrustSpanProcessor } = await import("./index");

      // Mock console.info to capture the default parent message
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      const processor = new BraintrustSpanProcessor({
        apiKey: "test-api-key",
        // No parent specified
      });

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain("default");

      consoleSpy.mockRestore();
      await processor.shutdown();
    });
  });
});

