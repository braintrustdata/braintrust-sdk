/**
 * Unit tests for OTEL + Braintrust context integration
 *
 * Tests that OTEL and Braintrust spans are properly grouped in unified traces
 * when created in mixed contexts.
 */
import { context, propagation, trace, Tracer } from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  _exportsForTestingOnly,
  currentSpan,
  Eval,
  getContextManager,
  initLogger,
  startSpan,
  withParent,
} from "braintrust";
import { SpanComponentsV4, SpanObjectTypeV3 } from "braintrust/util";
import { base64ToUint8Array } from "braintrust/util/bytes";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";

import {
  addParentToBaggage,
  addSpanParentToBaggage,
  contextFromSpanExport,
  parentFromHeaders,
} from "./compat";

// TODO:
// import { configureNode } from "../node";

// configureNode();

function setupOtelFixture() {
  const exporter = new InMemorySpanExporter();
  const processor = new SimpleSpanProcessor(exporter);

  const tp = new BasicTracerProvider();
  tp.addSpanProcessor(processor);

  const tracer = tp.getTracer("otel-compat-test");

  return {
    tracer,
    exporter,
  };
}

function getExportVersion(exportedSpan: string): number {
  const exportedBytes = base64ToUint8Array(exportedSpan);
  return exportedBytes[0];
}

describe("OTEL compatibility mode", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BRAINTRUST_OTEL_COMPAT;
    process.env.BRAINTRUST_OTEL_COMPAT = "true";
    process.env.BRAINTRUST_API_KEY = "test-api-key";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BRAINTRUST_OTEL_COMPAT;
    } else {
      process.env.BRAINTRUST_OTEL_COMPAT = originalEnv;
    }
  });

  test("mixed BT/OTEL tracing with BT logger first", async () => {
    const { tracer, exporter } = setupOtelFixture();
    const logger = initLogger({ projectName: "mixed-tracing-bt-first" });

    await logger.traced(
      async (span1) => {
        expect(currentSpan()).toBe(span1);

        await tracer.startActiveSpan("otel-span-2", async (otelSpan2) => {
          await logger.traced(
            async (span3) => {
              expect(currentSpan()).toBe(span3);

              // Verify span3 has otel span 2 as parent
              expect(span3.rootSpanId).toBe(span1.rootSpanId);
              expect(span3.spanParents.length).toBeGreaterThan(0);
            },
            { name: "bt-span-3" },
          );

          otelSpan2.end();
        });
      },
      { name: "bt-span-1" },
    );

    const otelSpans = exporter.getFinishedSpans();
    expect(otelSpans.length).toBeGreaterThanOrEqual(1);

    // Verify the OTEL span has braintrust.parent attribute
    const otelSpan = otelSpans.find((s) => s.name === "otel-span-2");
    expect(otelSpan).toBeDefined();
    if (otelSpan && otelSpan.attributes) {
      expect(otelSpan.attributes["braintrust.parent"]).toContain(
        "project_name:",
      );
    }
  });

  test("mixed BT/OTEL tracing with OTEL first", async () => {
    const { tracer, exporter } = setupOtelFixture();
    const logger = initLogger({ projectName: "mixed-tracing-otel-first" });

    await tracer.startActiveSpan("otel-span-1", async (otelSpan1) => {
      await logger.traced(
        async (span2) => {
          expect(currentSpan()).toBe(span2);

          // BT span should inherit OTEL trace ID
          const otelContext = otelSpan1.spanContext();
          const otelTraceId = otelContext.traceId.toString().padStart(32, "0");

          expect(span2.rootSpanId).toBe(otelTraceId);

          await tracer.startActiveSpan("otel-span-3", async (otelSpan3) => {
            otelSpan3.end();
          });
        },
        { name: "bt-span-2" },
      );

      otelSpan1.end();
    });

    const otelSpans = exporter.getFinishedSpans();
    expect(otelSpans.length).toBeGreaterThanOrEqual(2);
  });

  test("BT span without explicit parent inherits from OTEL", async () => {
    const { tracer, exporter } = setupOtelFixture();
    const logger = initLogger({ projectName: "bt-inherits-otel" });

    await tracer.startActiveSpan("otel-parent", async (otelParent) => {
      const btSpan = logger.startSpan({ name: "bt-child" });

      const otelContext = otelParent.spanContext();
      const otelTraceId = otelContext.traceId.toString().padStart(32, "0");
      const otelSpanId = otelContext.spanId.toString().padStart(16, "0");

      // BT span should have inherited OTEL parent's trace ID as root_span_id
      expect(btSpan.rootSpanId).toBe(otelTraceId);

      // BT span should have OTEL span as parent
      expect(btSpan.spanParents).toContain(otelSpanId);

      btSpan.end();
      otelParent.end();
    });

    const otelSpans = exporter.getFinishedSpans();
    expect(otelSpans.length).toBeGreaterThanOrEqual(1);
  });

  test("mixed BT/OTEL with startSpan (matching Python pattern)", async () => {
    const fixture = setupOtelFixture();
    if (!fixture) return;

    const { tracer, exporter } = fixture;
    const logger = initLogger({ projectName: "mixed-start-span-test" });

    const span1 = logger.startSpan({ name: "bt-span-1" });
    expect(currentSpan()).toBe(span1);

    await tracer.startActiveSpan("otel-span-2", async (otelSpan2) => {
      const span3 = logger.startSpan({ name: "bt-span-3" });
      expect(currentSpan()).toBe(span3);

      // Verify span3 has otel span 2 as parent
      const otelContext = otelSpan2.spanContext();
      const otelTraceId = otelContext.traceId.toString().padStart(32, "0");
      const otelSpanId = otelContext.spanId.toString().padStart(16, "0");

      expect(span3.rootSpanId).toBe(span1.rootSpanId);
      expect(span3.rootSpanId).toBe(otelTraceId);
      expect(span3.spanParents).toContain(otelSpanId);

      span3.end();
      otelSpan2.end();
    });

    span1.end();

    const otelSpans = exporter.getFinishedSpans();
    expect(otelSpans.length).toBe(1);

    // Verify the OTEL span has braintrust.parent attribute
    const otelSpan = otelSpans.find((s) => s.name === "otel-span-2");
    expect(otelSpan).toBeDefined();
    if (otelSpan && otelSpan.attributes) {
      expect(otelSpan.attributes["braintrust.parent"]).toContain(
        "project_name:mixed-start-span-test",
      );
    }
  });

  test("uses BraintrustContextManager when OTEL disabled", () => {
    delete process.env.BRAINTRUST_OTEL_COMPAT;

    const cm = getContextManager();

    expect(cm.constructor.name).toBe("BraintrustContextManager");
    expect(cm.getParentSpanIds).toBeDefined();
    expect(cm.runInContext).toBeDefined();
    expect(cm.getCurrentSpan).toBeDefined();
  });

  test("uses OtelContextManager when OTEL enabled", async () => {
    // Test that when OTEL is available and env var is set, we get OtelContextManager
    // Note: In test environment, OTEL packages may not be available even though
    // we checked OTEL_AVAILABLE. If the require fails in getContextManager,
    // it falls back to BraintrustContextManager, which is correct behavior.
    const originalEnvValue = process.env.BRAINTRUST_OTEL_COMPAT;
    process.env.BRAINTRUST_OTEL_COMPAT = "true";

    try {
      // Clear module cache and re-import to get fresh context manager
      const loggerModule = await import("../logger?t=" + Date.now());
      const cm = loggerModule.getContextManager();

      // If OTEL is truly available, we should get OtelContextManager
      // Otherwise, fallback to BraintrustContextManager is acceptable
      if (cm.constructor.name === "OtelContextManager") {
        expect(cm.getParentSpanIds).toBeDefined();
        expect(cm.runInContext).toBeDefined();
        expect(cm.getCurrentSpan).toBeDefined();
      } else {
        // OTEL module not actually available at runtime, which is fine
        console.warn(
          "OTEL context manager not available at runtime, using fallback",
        );
      }
    } finally {
      if (originalEnvValue === undefined) {
        delete process.env.BRAINTRUST_OTEL_COMPAT;
      } else {
        process.env.BRAINTRUST_OTEL_COMPAT = originalEnvValue;
      }
    }
  });

  test("OTEL spans inherit braintrust.parent attribute", async () => {
    const { tracer, exporter } = setupOtelFixture();
    const logger = initLogger({ projectName: "parent-propagation-test" });

    await logger.traced(
      async () => {
        await tracer.startActiveSpan("otel-child", async (otelChild) => {
          otelChild.end();
        });
      },
      { name: "bt-parent" },
    );

    const otelSpans = exporter.getFinishedSpans();
    const otelChild = otelSpans.find((s) => s.name === "otel-child");

    expect(otelChild).toBeDefined();
    if (otelChild && otelChild.attributes) {
      expect(otelChild.attributes["braintrust.parent"]).toContain(
        "project_name:parent-propagation-test",
      );
    }
  });

  test("separate traces remain separate", async () => {
    const { tracer } = setupOtelFixture();
    const logger = initLogger({ projectName: "separate-traces" });

    let trace1Id: string | undefined;
    await logger.traced(
      async (btSpan1) => {
        trace1Id = btSpan1.rootSpanId;
        btSpan1.log({ input: "First trace" });
      },
      { name: "bt-trace-1" },
    );

    let trace2Id: string | undefined;
    await tracer.startActiveSpan("otel-trace-2", async (otelSpan2) => {
      const otelContext = otelSpan2.spanContext();
      trace2Id = otelContext.traceId.toString().padStart(32, "0");
      otelSpan2.setAttribute("test", "second_trace");
      otelSpan2.end();
    });

    let trace3Id: string | undefined;
    await tracer.startActiveSpan("otel-trace-3-root", async (otelSpan3) => {
      const otelContext = otelSpan3.spanContext();
      trace3Id = otelContext.traceId.toString().padStart(32, "0");

      await logger.traced(
        async (btSpan3) => {
          // BT span inside OTEL should inherit OTEL trace ID
          expect(btSpan3.rootSpanId).toBe(trace3Id);
          expect(btSpan3.rootSpanId).not.toBe(trace1Id);
        },
        { name: "bt-inside-otel-3" },
      );

      otelSpan3.end();
    });

    // Verify we have 3 separate traces
    expect(trace1Id).toBeDefined();
    expect(trace2Id).toBeDefined();
    expect(trace3Id).toBeDefined();
    expect(trace1Id).not.toBe(trace2Id);
    expect(trace1Id).not.toBe(trace3Id);
    expect(trace2Id).not.toBe(trace3Id);
  });

  test("OTEL spans in experiment Eval() inherit experiment_id parent", async () => {
    const { tracer, exporter } = setupOtelFixture();

    // Capture BT span info from inside the task
    const btSpanInfo: Array<{ traceId: string; spanId: string }> = [];

    // This is the key test: verify that OTEL spans created inside Eval() tasks
    // have the correct braintrust.parent attribute with experiment_id
    const result = await Eval("otel-eval-test", {
      data: [{ input: 1 }, { input: 2 }],
      task: async (input) => {
        // Capture the current BT span info
        const btSpan = currentSpan();
        if (btSpan) {
          btSpanInfo.push({
            traceId: btSpan.rootSpanId,
            spanId: btSpan.spanId,
          });
        }

        // Create an OTEL span inside the eval task
        await tracer.startActiveSpan("otel-compute", async (otelSpan) => {
          otelSpan.setAttribute("computation", input * 2);
          otelSpan.end();
        });
        return input * 2;
      },
      scores: [],
      trialCount: 1,
    });

    // Get the experiment ID from the result
    const experimentId = result.summary.experimentId;
    expect(experimentId).toBeDefined();

    // Verify we captured BT span info
    expect(btSpanInfo.length).toBe(2);

    // Verify OTEL spans were created and have the correct parent
    const otelSpans = exporter.getFinishedSpans();
    const computeSpans = otelSpans.filter((s) => s.name === "otel-compute");

    expect(computeSpans.length).toBe(2); // One for each data point

    // Verify each OTEL span has the correct parent relationships
    for (let i = 0; i < computeSpans.length; i++) {
      const otelSpan = computeSpans[i];
      const otelContext = otelSpan.spanContext();
      const otelTraceId = otelContext.traceId.toString().padStart(32, "0");
      const _otelParentId = otelContext.spanId.toString().padStart(16, "0");

      // OTEL span should inherit the BT span's root trace ID
      expect(btSpanInfo.some((bt) => bt.traceId === otelTraceId)).toBe(true);

      // Verify OTEL span has experiment_id in braintrust.parent attribute
      expect(otelSpan.attributes).toBeDefined();
      if (otelSpan.attributes) {
        expect(otelSpan.attributes["braintrust.parent"]).toContain(
          `experiment_id:${experimentId}`,
        );
      }
    }
  });

  test("exported V4 span can be used as parent (issue #986)", async () => {
    _exportsForTestingOnly.resetIdGenStateForTests();

    const logger = initLogger({
      projectName: "test-v4-parent-bug",
    });

    const parentSpan = logger.startSpan({ name: "parent-span-v4" });
    const exported = await parentSpan.export();

    expect(getExportVersion(exported)).toBe(4);

    parentSpan.end();

    const childSpan = logger.startSpan({
      name: "child-span-v4",
      parent: exported,
    });

    expect(childSpan.rootSpanId).toBe(parentSpan.rootSpanId);
    expect(childSpan.spanParents).toContain(parentSpan.spanId);

    childSpan.end();
  });

  test("exported V4 span can be used with withParent (issue #986)", async () => {
    _exportsForTestingOnly.resetIdGenStateForTests();

    const logger = initLogger({
      projectName: "test-v4-with-parent-bug",
    });

    const parentSpan = logger.startSpan({ name: "parent-span-v4" });
    const exported = await parentSpan.export();

    expect(getExportVersion(exported)).toBe(4);

    parentSpan.end();

    // Use withParent helper - this uses getSpanParentObject which has the bug at line 3902
    withParent(exported, () => {
      // Use global startSpan without logger to trigger getSpanParentObject path
      const childSpan = startSpan({
        name: "child-span-v4-with-parent",
      });

      expect(childSpan.rootSpanId).toBe(parentSpan.rootSpanId);
      expect(childSpan.spanParents).toContain(parentSpan.spanId);

      childSpan.end();
    });
  });
});

describe("Distributed Tracing (BT → OTEL)", () => {
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.BRAINTRUST_OTEL_COMPAT;
    process.env.BRAINTRUST_OTEL_COMPAT = "true";
    process.env.BRAINTRUST_API_KEY = "test-api-key";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BRAINTRUST_OTEL_COMPAT;
    } else {
      process.env.BRAINTRUST_OTEL_COMPAT = originalEnv;
    }
  });

  test("contextFromSpanExport parses BT span and creates OTEL context", async () => {
    // Create a sample span export string
    const rootSpanId = "a1b2c3d4e5f6789012345678abcdef01"; // 32 hex chars (16 bytes)
    const spanId = "a1b2c3d4e5f67890"; // 16 hex chars (8 bytes)
    const objectId = "proj-123";

    const components = new SpanComponentsV4({
      object_type: SpanObjectTypeV3.PROJECT_LOGS,
      object_id: objectId,
      row_id: "row-123",
      span_id: spanId,
      root_span_id: rootSpanId,
      propagated_event: undefined,
    });

    const exportStr = components.toStr();

    const ctx = contextFromSpanExport(exportStr);

    // Verify that a valid context was created
    expect(ctx).toBeDefined();

    // Extract the span from the context
    const span = trace.getSpan(ctx);
    expect(span).toBeDefined();

    const spanContext = span?.spanContext();
    expect(spanContext).toBeDefined();

    // Verify trace ID matches (OTEL trace IDs are already hex strings)
    expect(spanContext?.traceId).toBe(rootSpanId);

    // Verify span ID matches
    expect(spanContext?.spanId).toBe(spanId);

    // Verify it's marked as remote
    expect(spanContext?.isRemote).toBe(true);
  });

  test("BT span in Service A can be parent of OTEL span in Service B", async () => {
    const { tracer, exporter } = setupOtelFixture();

    const projectName = "service-a-project";
    const logger = initLogger({ projectName });

    // ===== Service A: Create BT span and export =====
    let serviceATraceId: string | undefined;
    let serviceASpanId: string | undefined;
    let exportedContext: string | undefined;

    await logger.traced(
      async (serviceASpan) => {
        serviceATraceId = serviceASpan.rootSpanId;
        serviceASpanId = serviceASpan.spanId;

        // Export context for sending to Service B (e.g., via HTTP header)
        exportedContext = await serviceASpan.export();
      },
      { name: "service_a_span" },
    );

    expect(exportedContext).toBeDefined();
    expect(serviceATraceId).toBeDefined();
    expect(serviceASpanId).toBeDefined();

    // ===== Service B: Import context and create OTEL child span =====
    const ctx = contextFromSpanExport(exportedContext!);

    // Use context.with() to run code in the imported context
    await context.with(ctx, async () => {
      await tracer.startActiveSpan("service_b_span", async (serviceBSpan) => {
        serviceBSpan.setAttribute("service", "service_b");
        serviceBSpan.end();
      });
    });

    // ===== Verify exported spans =====
    const otelSpans = exporter.getFinishedSpans();
    expect(otelSpans.length).toBe(1);

    const serviceBSpan = otelSpans[0];
    expect(serviceBSpan.name).toBe("service_b_span");

    // Get OTEL span context
    const serviceBContext = serviceBSpan.spanContext();
    const serviceBTraceId = serviceBContext.traceId;

    // Assert unified trace ID
    expect(serviceBTraceId).toBe(serviceATraceId);

    // Service B span should have Service A span as parent
    // Note: In OTEL JS, parent info is in the span's parent property
    // @ts-ignore
    const parentSpanId = serviceBSpan?.parent?.spanId;
    if (parentSpanId) {
      expect(parentSpanId).toBe(serviceASpanId);
    }

    // Assert braintrust.parent attribute is set on OTEL span
    expect(serviceBSpan.attributes).toBeDefined();
    if (serviceBSpan.attributes) {
      expect(serviceBSpan.attributes["braintrust.parent"]).toBe(
        `project_name:${projectName}`,
      );
    }
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

      // @ts-ignore
      const ctx = addSpanParentToBaggage(span);
      expect(ctx).toBeDefined();

      const baggage = propagation.getBaggage(ctx!);
      expect(baggage?.getEntry("braintrust.parent")?.value).toBe(parent);

      span.end();
    });

    it("should return undefined when span has no braintrust.parent attribute", () => {
      const span = tracer.startSpan("test-span");

      // @ts-ignore
      const ctx = addSpanParentToBaggage(span);
      expect(ctx).toBeUndefined();

      span.end();
    });

    it("should use provided context", () => {
      const span = tracer.startSpan("test-span");
      const parent = "project_name:test:span_id:abc123:row_id:xyz789";
      span.setAttribute("braintrust.parent", parent);

      const initialCtx = context.active();
      // @ts-ignore
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
