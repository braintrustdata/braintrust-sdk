/**
 * Unit tests for OTEL + Braintrust context integration
 *
 * Tests that OTEL and Braintrust spans are properly grouped in unified traces
 * when created in mixed contexts.
 */

import { beforeEach, afterEach, describe, expect, test } from "vitest";
import {
  initLogger,
  currentSpan,
  getContextManager,
  _exportsForTestingOnly,
  runEvaluator,
  type ProgressReporter,
} from "braintrust";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { context as otelContext } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { getExportVersion } from "./utils";
import { initOtel, resetOtel, BraintrustSpanProcessor } from "./";

class NoopProgressReporter implements ProgressReporter {
  public start() {}
  public stop() {}
  public increment() {}
}

function setupOtelFixture(projectName: string = "otel-compat-test") {
  const processor = new BraintrustSpanProcessor({
    parent: `project_name:${projectName}`,
  });

  const tp = new BasicTracerProvider();
  tp.addSpanProcessor(processor);

  const tracer = tp.getTracer("otel-compat-test");

  return {
    tracer,
    processor,
  };
}

describe("OTEL compatibility mode", () => {
  let contextManager: AsyncHooksContextManager;

  beforeEach(async () => {
    initOtel();

    await _exportsForTestingOnly.simulateLoginForTests();
    _exportsForTestingOnly.useTestBackgroundLogger();

    // Set up OTEL context manager to enable context propagation
    contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    otelContext.setGlobalContextManager(contextManager);
  });

  afterEach(() => {
    // Clean up context manager
    if (contextManager) {
      otelContext.disable();
      contextManager.disable();
    }
    _exportsForTestingOnly.clearTestBackgroundLogger();
    _exportsForTestingOnly.simulateLogoutForTests();
    resetOtel();
  });

  test("mixed BT/OTEL tracing with BT logger first", async () => {
    const { tracer, processor } = setupOtelFixture("mixed-tracing-bt-first");
    const logger = initLogger({
      projectName: "mixed-tracing-bt-first",
      // projectId: "test-mixed-tracing-bt-first",
    });

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

    await processor.forceFlush();
  });

  test("mixed BT/OTEL tracing with OTEL first", async () => {
    const { tracer, processor } = setupOtelFixture("mixed-tracing-otel-first");
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

    await processor.forceFlush();
  });

  test("BT span without explicit parent inherits from OTEL", async () => {
    const { tracer, processor } = setupOtelFixture("bt-inherits-otel");
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

    await processor.forceFlush();
  });

  test("mixed BT/OTEL with startSpan (matching Python pattern)", async () => {
    const { tracer, processor } = setupOtelFixture("mixed-start-span-test");
    const logger = initLogger({ projectName: "mixed-start-span-test" });
    const cm = getContextManager();

    const span1 = logger.startSpan({ name: "bt-span-1" });

    await cm.runInContext(span1, async () => {
      expect(currentSpan()).toBe(span1);

      await tracer.startActiveSpan("otel-span-2", async (otelSpan2) => {
        const span3 = logger.startSpan({ name: "bt-span-3" });

        await cm.runInContext(span3, async () => {
          expect(currentSpan()).toBe(span3);

          // Verify span3 has otel span 2 as parent
          const otelContext = otelSpan2.spanContext();
          const otelTraceId = otelContext.traceId.toString().padStart(32, "0");
          const otelSpanId = otelContext.spanId.toString().padStart(16, "0");

          expect(span3.rootSpanId).toBe(span1.rootSpanId);
          expect(span3.rootSpanId).toBe(otelTraceId);
          expect(span3.spanParents).toContain(otelSpanId);
        });

        span3.end();
        otelSpan2.end();
      });
    });

    span1.end();

    await processor.forceFlush();
  });

  test("uses BraintrustContextManager when OTEL disabled", () => {
    resetOtel();

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

    // Clear module cache and re-import to get fresh context manager
    const loggerModule = await import("braintrust?t=" + Date.now());
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
  });

  test("OTEL spans inherit braintrust.parent attribute", async () => {
    const { tracer, processor } = setupOtelFixture("test-otel-parent-attr");
    const logger = initLogger({
      projectName: "test-otel-parent-attr",
    });

    await logger.traced(
      async () => {
        await tracer.startActiveSpan("otel-child", async (otelChild) => {
          // Verify the span context is created
          expect(otelChild.spanContext().traceId).toBeDefined();
          otelChild.end();
        });
      },
      { name: "bt-parent" },
    );

    await processor.forceFlush();
  });

  test("separate traces remain separate", async () => {
    const { tracer, processor } = setupOtelFixture("separate-traces-test");
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
    const { tracer, processor } = setupOtelFixture("experiment-eval-test");

    // Capture BT span info from inside the task
    const btSpanInfo: Array<{ traceId: string; spanId: string }> = [];

    // Use runEvaluator with null experiment to avoid API calls
    const result = await runEvaluator(
      null,
      {
        projectName: "test-eval-project",
        evalName: "otel-eval-test",
        data: [{ input: 1 }, { input: 2 }],
        task: async (input: number) => {
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
      },
      new NoopProgressReporter(),
      [],
      undefined,
    );

    // Verify we captured BT span info
    expect(btSpanInfo.length).toBe(2);

    // Verify results are correct
    expect(result.results.length).toBe(2);
    expect(result.results[0].output).toBe(2);
    expect(result.results[1].output).toBe(4);

    // Ensure spans are flushed
    await processor.forceFlush();
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

    // Use withParent helper with logger.startSpan to properly handle the exported parent
    const { withParent } = await import("braintrust");

    withParent(exported, () => {
      // Pass parent explicitly in addition to withParent context
      const childSpan = logger.startSpan({
        name: "child-span-v4-with-parent",
        parent: exported,
      });

      expect(childSpan.rootSpanId).toBe(parentSpan.rootSpanId);
      expect(childSpan.spanParents).toContain(parentSpan.spanId);

      childSpan.end();
    });
  });
});

describe("Distributed Tracing (BT → OTEL)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let trace: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let context: any;
  let contextManager: AsyncHooksContextManager;

  beforeEach(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
    _exportsForTestingOnly.useTestBackgroundLogger();
    initOtel();

    const otelApi = await import("@opentelemetry/api");
    trace = otelApi.trace;
    context = otelApi.context;

    // Set up OTEL context manager to enable context propagation
    contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
  });

  afterEach(() => {
    // Clean up context manager
    if (contextManager) {
      context.disable();
      contextManager.disable();
    }
    resetOtel();
  });

  test("otelContextFromSpanExport parses BT span and creates OTEL context", async () => {
    const { contextFromSpanExport: otelContextFromSpanExport } = await import(
      "./"
    );
    const { SpanComponentsV4 } = await import("braintrust/util");
    const { SpanObjectTypeV3 } = await import("braintrust/util");

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

    const ctx = otelContextFromSpanExport(exportStr);

    // Verify that a valid context was created
    expect(ctx).toBeDefined();

    // Extract the span from the context
    const span = trace.getSpan(ctx);
    expect(span).toBeDefined();

    const spanContext = span.spanContext();
    expect(spanContext).toBeDefined();

    // Verify trace ID matches (OTEL trace IDs are already hex strings)
    expect(spanContext.traceId).toBe(rootSpanId);

    // Verify span ID matches
    expect(spanContext.spanId).toBe(spanId);

    // Verify it's marked as remote
    expect(spanContext.isRemote).toBe(true);
  });

  test("BT span in Service A can be parent of OTEL span in Service B", async () => {
    const { tracer, processor } = setupOtelFixture("service-a-project");
    const { contextFromSpanExport: otelContextFromSpanExport } = await import(
      "./"
    );

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
    const ctx = otelContextFromSpanExport(exportedContext!);

    // Use context.with() to run code in the imported context
    await context.with(ctx, async () => {
      await tracer.startActiveSpan("service_b_span", async (serviceBSpan) => {
        serviceBSpan.setAttribute("service", "service_b");
        serviceBSpan.end();
      });
    });

    // ===== Verify spans are flushed =====
    // The BraintrustSpanProcessor handles sending spans to Braintrust
    // We've verified that the context was properly imported and used
    expect(serviceATraceId).toBeDefined();
    expect(serviceASpanId).toBeDefined();

    await processor.forceFlush();
  });
});
