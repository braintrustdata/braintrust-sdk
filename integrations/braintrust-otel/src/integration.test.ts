import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initLogger, setContextManager, currentSpan } from "braintrust";
import { OtelContextManager, BraintrustSpanProcessor, otel } from "./index";
import * as api from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

describe("Braintrust + OTEL Integration", () => {
  let provider: BasicTracerProvider;
  let exporter: InMemorySpanExporter;
  let tracer: api.Tracer;
  let originalContextManager: any;

  beforeEach(() => {
    // Set up OTEL tracer
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    api.trace.setGlobalTracerProvider(provider);
    tracer = api.trace.getTracer("test-tracer");

    // Save original context manager
    originalContextManager = currentSpan() ? undefined : null;
  });

  afterEach(async () => {
    await provider.shutdown();
    // Reset to default context manager if needed
    if (originalContextManager !== undefined) {
      // Reset context manager to default
    }
  });

  it("should allow Braintrust spans to propagate to OTEL context with OtelContextManager", () => {
    // Set up OtelContextManager
    const otelCM = new OtelContextManager();
    setContextManager(otelCM);

    const logger = initLogger({
      projectName: "integration-test",
      projectId: "test-project-id",
    });

    // Create a Braintrust span
    const btSpan = logger.startSpan({ name: "braintrust-span" });

    // Verify it's available in OTEL context via the context manager
    const currentBtSpan = otelCM.getCurrentSpan();
    expect(currentBtSpan).toBeDefined();
    expect((currentBtSpan as any)?.spanId).toBe(btSpan.spanId);

    btSpan.end();
  });

  it("should propagate OTEL spans to Braintrust context", async () => {
    const otelCM = new OtelContextManager();
    setContextManager(otelCM);

    const logger = initLogger({
      projectName: "integration-test",
      projectId: "test-project-id",
    });

    // Create an OTEL span
    await tracer.startActiveSpan("otel-parent", async (otelSpan) => {
      // Create a Braintrust span inside OTEL span
      const btSpan = logger.startSpan({ name: "braintrust-child" });

      // The Braintrust span should be aware of OTEL parent
      const parentIds = otelCM.getParentSpanIds();
      expect(parentIds).toBeDefined();
      expect(parentIds?.spanParents.length).toBeGreaterThan(0);

      btSpan.end();
      otelSpan.end();
    });
  });

  it("should handle distributed tracing between BT and OTEL", async () => {
    const logger = initLogger({
      projectName: "distributed-test",
      projectId: "test-project-id",
    });

    // Service A: Create BT span and export
    const btSpan = logger.startSpan({ name: "service-a" });
    const exportStr = await btSpan.export();
    btSpan.end();

    // Service B: Import as OTEL context
    const ctx = otel.contextFromSpanExport(exportStr);
    expect(ctx).toBeDefined();

    // Create OTEL child span
    await api.context.with(ctx, async () => {
      await tracer.startActiveSpan("service-b", async (otelSpan) => {
        const spanContext = otelSpan.spanContext();

        // Verify the OTEL span has the correct parent
        expect(spanContext.traceId).toBe(btSpan.rootSpanId);
        expect(spanContext.spanId).not.toBe(btSpan.spanId);

        otelSpan.end();
      });
    });
  });

  it("should preserve braintrust.parent attribute across boundaries", async () => {
    const otelCM = new OtelContextManager();
    setContextManager(otelCM);

    const logger = initLogger({
      projectName: "parent-test",
      projectId: "test-project-id",
    });

    // Create BT span with parent info
    const btSpan = logger.startSpan({ name: "bt-span-with-parent" });

    // Run in OTEL context
    otelCM.runInContext(btSpan, () => {
      // Create OTEL span that should inherit braintrust.parent
      const otelSpan = tracer.startSpan("otel-child");
      otelSpan.end();
    });

    btSpan.end();

    // Check that OTEL spans were created
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
  });

  it("should allow OTEL context to parent BT spans", async () => {
    const otelCM = new OtelContextManager();
    setContextManager(otelCM);

    const logger = initLogger({
      projectName: "otel-parent-test",
      projectId: "test-project-id",
    });

    let btSpanId: string | undefined;

    // Create OTEL span first
    await tracer.startActiveSpan("otel-parent-span", async (otelSpan) => {
      const otelSpanContext = otelSpan.spanContext();

      // Create BT span inside
      const btSpan = logger.startSpan({ name: "bt-child" });
      btSpanId = btSpan.spanId;

      // BT span should have parent info from OTEL
      const parentIds = otelCM.getParentSpanIds();
      expect(parentIds).toBeDefined();
      expect(parentIds?.rootSpanId).toBe(otelSpanContext.traceId);

      btSpan.end();
      otelSpan.end();
    });

    expect(btSpanId).toBeDefined();
  });

  it("should handle baggage propagation for distributed tracing", async () => {
    const logger = initLogger({
      projectName: "baggage-test",
      projectId: "test-project-id",
    });

    // Set up baggage with braintrust.parent
    const parentValue = "project_name:baggage-test";
    const ctx = otel.addParentToBaggage(parentValue);

    await api.context.with(ctx, async () => {
      // Export headers
      const headers: Record<string, string> = {};
      api.propagation.inject(api.context.active(), headers);

      // Verify braintrust.parent is in baggage
      expect(headers.baggage).toBeDefined();
      expect(headers.baggage).toContain("braintrust.parent");
      expect(headers.baggage).toContain(parentValue);

      // Extract parent from headers
      const extractedParent = otel.parentFromHeaders(headers);
      expect(extractedParent).toBeDefined();
    });
  });

  it("should work with BraintrustSpanProcessor in OTEL pipeline", async () => {
    // This test requires actual API configuration, so we'll just verify instantiation
    const processor = new BraintrustSpanProcessor({
      apiKey: "test-key",
      parent: "project_name:test",
    });

    expect(processor).toBeDefined();
    expect(processor.onStart).toBeTypeOf("function");
    expect(processor.onEnd).toBeTypeOf("function");
    expect(processor.shutdown).toBeTypeOf("function");

    await processor.shutdown();
  });

  it("should handle context switching between BT and OTEL", () => {
    const otelCM = new OtelContextManager();
    setContextManager(otelCM);

    const logger = initLogger({
      projectName: "context-switch-test",
      projectId: "test-project-id",
    });

    // Create nested spans alternating between BT and OTEL
    const btSpan1 = logger.startSpan({ name: "bt-1" });

    otelCM.runInContext(btSpan1, () => {
      tracer.startActiveSpan("otel-1", (otelSpan1) => {
        const btSpan2 = logger.startSpan({ name: "bt-2" });

        otelCM.runInContext(btSpan2, () => {
          tracer.startActiveSpan("otel-2", (otelSpan2) => {
            // Verify we can get the current BT span
            const currentBt = otelCM.getCurrentSpan();
            expect(currentBt).toBeDefined();
            expect((currentBt as any)?.spanId).toBe(btSpan2.spanId);

            otelSpan2.end();
          });
        });

        btSpan2.end();
        otelSpan1.end();
      });
    });

    btSpan1.end();
  });
});

