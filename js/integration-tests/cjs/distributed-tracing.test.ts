import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import * as api from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import braintrust from "../../dist/index.js";

const {
  initLogger,
  login,
  otel,
  BraintrustSpanProcessor,
  _exportsForTestingOnly,
} = braintrust;

const { trace, context, propagation } = api;

describe("Distributed Tracing: BT → OTEL → BT", () => {
  let provider: BasicTracerProvider;
  let tracer: api.Tracer;
  let contextManager: AsyncHooksContextManager;
  let logger: ReturnType<typeof initLogger>;
  let testLogger: ReturnType<
    typeof _exportsForTestingOnly.useTestBackgroundLogger
  >;

  beforeAll(async () => {
    process.env.BRAINTRUST_OTEL_COMPAT = "true";

    provider = new BasicTracerProvider({
      spanProcessors: [new BraintrustSpanProcessor()],
    });
    trace.setGlobalTracerProvider(provider);
    tracer = trace.getTracer("service-b");

    contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);

    await _exportsForTestingOnly.simulateLoginForTests();
    logger = initLogger({
      projectName: "otel-integration-tests",
      projectId: "test-project-id",
    });
  });

  beforeEach(() => {
    testLogger = _exportsForTestingOnly.useTestBackgroundLogger();
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  afterAll(async () => {
    await logger.flush();
    await provider.forceFlush();
    contextManager.disable();
  });

  it("should successfully trace across BT → OTEL → BT services", async () => {
    let spanLink = "";
    let spanCId: string | undefined;

    await logger.traced(async (spanA) => {
      spanLink = spanA.link();
      const exported = await spanA.export();

      expect(exported).toBeDefined();
      expect(typeof exported).toBe("string");

      const ctx = otel.contextFromSpanExport(exported);
      await context.with(ctx, async () => {
        await tracer.startActiveSpan("service_b", async (spanB: api.Span) => {
          const currentCtx = otel.addSpanParentToBaggage(spanB);
          const headers: Record<string, string> = {};
          propagation.inject(currentCtx, headers);

          expect(headers).toBeDefined();
          expect(Object.keys(headers).length).toBeGreaterThan(0);

          const parent = otel.parentFromHeaders(headers);
          await logger.traced(
            async (spanC) => {
              spanC.log({ input: { message: "from service B" } });
              spanCId = spanC.id;
            },
            { name: "service_c", parent },
          );

          spanB.end();
        });
      });
    });

    expect(spanLink).toBeTruthy();
    expect(spanCId).toBeDefined();

    await testLogger.flush();
    const spans = await testLogger.drain();

    expect(spans.length).toBeGreaterThanOrEqual(2);

    const spanNames = spans.map((s: any) => s.span_attributes?.name);
    expect(spanNames).toContain("service_c");

    const serviceCSpan = spans.find(
      (s: any) => s.span_attributes?.name === "service_c",
    );
    expect(serviceCSpan).toBeDefined();
    expect(serviceCSpan.input).toEqual({ message: "from service B" });
  }, 30000);

  it("should propagate context correctly through OTEL middleware", async () => {
    const results: string[] = [];

    await logger.traced(async (spanA) => {
      results.push("spanA");
      spanA.log({ input: { service: "A" } });

      const exported = await spanA.export();
      const ctx = otel.contextFromSpanExport(exported);

      await context.with(ctx, async () => {
        await tracer.startActiveSpan(
          "service_b_operation",
          async (spanB: api.Span) => {
            results.push("spanB");
            spanB.setAttribute("operation", "process");

            const currentCtx = otel.addSpanParentToBaggage(spanB);
            const headers: Record<string, string> = {};
            propagation.inject(currentCtx, headers);

            const parent = otel.parentFromHeaders(headers);
            await logger.traced(
              async (spanC) => {
                results.push("spanC");
                spanC.log({ output: { result: "processed" } });
              },
              { name: "service_c_operation", parent },
            );

            spanB.end();
          },
        );
      });
    });

    expect(results).toEqual(["spanA", "spanB", "spanC"]);

    await testLogger.flush();
    const spans = await testLogger.drain();

    expect(spans.length).toBeGreaterThanOrEqual(2);

    const serviceASpan = spans.find((s: any) => s.input?.service === "A");
    expect(serviceASpan).toBeDefined();

    const serviceCSpan = spans.find(
      (s: any) => s.span_attributes?.name === "service_c_operation",
    );
    expect(serviceCSpan).toBeDefined();
    expect(serviceCSpan.output).toEqual({ result: "processed" });
  }, 30000);

  it("should handle multiple parallel OTEL operations", async () => {
    const operations = ["op1", "op2", "op3"];
    const completedOps: string[] = [];

    await logger.traced(async (spanA) => {
      const exported = await spanA.export();
      const ctx = otel.contextFromSpanExport(exported);

      await Promise.all(
        operations.map((op) =>
          context.with(ctx, async () => {
            await tracer.startActiveSpan(
              `service_b_${op}`,
              async (spanB: api.Span) => {
                const currentCtx = otel.addSpanParentToBaggage(spanB);
                const headers: Record<string, string> = {};
                propagation.inject(currentCtx, headers);

                const parent = otel.parentFromHeaders(headers);
                await logger.traced(
                  async (spanC) => {
                    spanC.log({ input: { operation: op } });
                    completedOps.push(op);
                  },
                  { name: `service_c_${op}`, parent },
                );

                spanB.end();
              },
            );
          }),
        ),
      );
    });

    expect(completedOps.sort()).toEqual(operations.sort());

    await testLogger.flush();
    const spans = await testLogger.drain();

    expect(spans.length).toBeGreaterThanOrEqual(3);

    const serviceCSpans = spans.filter((s: any) =>
      s.span_attributes?.name?.startsWith("service_c_"),
    );
    expect(serviceCSpans.length).toBe(3);

    const loggedOps = serviceCSpans.map((s: any) => s.input?.operation).sort();
    expect(loggedOps).toEqual(operations.sort());
  }, 30000);
});
