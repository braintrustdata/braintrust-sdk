import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BraintrustSpanProcessor, _exportsForTestingOnly } from "braintrust";
import { trace } from "@opentelemetry/api";

describe("NodeSDK with BraintrustSpanProcessor", () => {
  let sdk: NodeSDK;
  let testLogger: ReturnType<
    typeof _exportsForTestingOnly.useTestBackgroundLogger
  >;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();

    sdk = new NodeSDK({
      serviceName: "integration-test-service",
      spanProcessor: new BraintrustSpanProcessor({
        parent: "project_name:otel-integration-tests",
        filterAISpans: true,
      }),
    });

    sdk.start();
  });

  beforeEach(() => {
    testLogger = _exportsForTestingOnly.useTestBackgroundLogger();
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  afterAll(async () => {
    await sdk.shutdown();
  });

  it("should initialize NodeSDK with BraintrustSpanProcessor", () => {
    expect(sdk).toBeDefined();
    const tracer = trace.getTracer("test-service", "1.0.0");
    expect(tracer).toBeDefined();
  });

  it("should create and export root spans", async () => {
    const tracer = trace.getTracer("test-service", "1.0.0");

    await tracer.startActiveSpan("test_root_span", async (rootSpan) => {
      rootSpan.setAttributes({
        "test.type": "integration",
        "test.timestamp": new Date().toISOString(),
      });

      expect(rootSpan.spanContext().traceId).toBeTruthy();
      expect(rootSpan.spanContext().spanId).toBeTruthy();

      rootSpan.end();
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await testLogger.flush();
    const spans = await testLogger.drain();

    expect(spans.length).toBeGreaterThanOrEqual(1);

    const rootSpan = spans.find(
      (s: any) => s.span_attributes?.name === "test_root_span",
    );
    expect(rootSpan).toBeDefined();
    expect(rootSpan.metadata?.["test.type"]).toBe("integration");
  }, 15000);

  it("should filter AI spans when filterAISpans is enabled", async () => {
    const tracer = trace.getTracer("test-service", "1.0.0");

    await tracer.startActiveSpan("test_filter_ai", async (rootSpan) => {
      rootSpan.setAttributes({
        "test.id": "filter_test",
      });

      await tracer.startActiveSpan(
        "gen_ai.chat.completions",
        async (aiSpan) => {
          aiSpan.setAttributes({
            "gen_ai.system": "openai",
            "gen_ai.operation.name": "chat.completions",
            "gen_ai.request.model": "gpt-4",
          });

          expect(aiSpan.spanContext().spanId).toBeTruthy();
          aiSpan.end();
        },
      );

      await tracer.startActiveSpan("non_ai_operation", async (nonAiSpan) => {
        nonAiSpan.setAttributes({
          "operation.type": "database",
        });

        expect(nonAiSpan.spanContext().spanId).toBeTruthy();
        nonAiSpan.end();
      });

      rootSpan.end();
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await testLogger.flush();
    const spans = await testLogger.drain();

    expect(spans.length).toBeGreaterThanOrEqual(2);

    const spanNames = spans.map((s: any) => s.span_attributes?.name);
    expect(spanNames).toContain("test_filter_ai");
    expect(spanNames).toContain("gen_ai.chat.completions");

    const aiSpan = spans.find(
      (s: any) => s.span_attributes?.name === "gen_ai.chat.completions",
    );
    expect(aiSpan).toBeDefined();
    expect(aiSpan.metadata?.["gen_ai.system"]).toBe("openai");
  }, 15000);

  it("should handle nested spans correctly", async () => {
    const tracer = trace.getTracer("test-service", "1.0.0");
    const spanIds: string[] = [];

    await tracer.startActiveSpan("parent_operation", async (parentSpan) => {
      spanIds.push(parentSpan.spanContext().spanId);

      parentSpan.setAttributes({
        operation: "parent",
        level: 0,
      });

      await tracer.startActiveSpan("child_operation_1", async (child1) => {
        spanIds.push(child1.spanContext().spanId);
        child1.setAttributes({
          operation: "child1",
          level: 1,
        });

        await tracer.startActiveSpan(
          "grandchild_operation",
          async (grandchild) => {
            spanIds.push(grandchild.spanContext().spanId);
            grandchild.setAttributes({
              operation: "grandchild",
              level: 2,
            });
            grandchild.end();
          },
        );

        child1.end();
      });

      await tracer.startActiveSpan("child_operation_2", async (child2) => {
        spanIds.push(child2.spanContext().spanId);
        child2.setAttributes({
          operation: "child2",
          level: 1,
        });
        child2.end();
      });

      parentSpan.end();
    });

    expect(spanIds).toHaveLength(4);
    expect(new Set(spanIds).size).toBe(4);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await testLogger.flush();
    const spans = await testLogger.drain();

    expect(spans.length).toBeGreaterThanOrEqual(4);

    const parentSpan = spans.find(
      (s: any) => s.metadata?.operation === "parent",
    );
    const child1Span = spans.find(
      (s: any) => s.metadata?.operation === "child1",
    );
    const grandchildSpan = spans.find(
      (s: any) => s.metadata?.operation === "grandchild",
    );
    const child2Span = spans.find(
      (s: any) => s.metadata?.operation === "child2",
    );

    expect(parentSpan).toBeDefined();
    expect(child1Span).toBeDefined();
    expect(grandchildSpan).toBeDefined();
    expect(child2Span).toBeDefined();

    expect(parentSpan.metadata?.level).toBe(0);
    expect(child1Span.metadata?.level).toBe(1);
    expect(grandchildSpan.metadata?.level).toBe(2);
    expect(child2Span.metadata?.level).toBe(1);
  }, 15000);

  it("should capture span attributes correctly", async () => {
    const tracer = trace.getTracer("test-service", "1.0.0");

    await tracer.startActiveSpan("attribute_test", async (span) => {
      const testAttributes = {
        "string.attr": "test_value",
        "number.attr": 42,
        "boolean.attr": true,
        "timestamp.attr": new Date().toISOString(),
      };

      span.setAttributes(testAttributes);

      expect(span.spanContext().traceId).toBeTruthy();

      span.end();
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await testLogger.flush();
    const spans = await testLogger.drain();

    expect(spans.length).toBeGreaterThanOrEqual(1);

    const attrSpan = spans.find(
      (s: any) => s.span_attributes?.name === "attribute_test",
    );
    expect(attrSpan).toBeDefined();
    expect(attrSpan.metadata?.["string.attr"]).toBe("test_value");
    expect(attrSpan.metadata?.["number.attr"]).toBe(42);
    expect(attrSpan.metadata?.["boolean.attr"]).toBe(true);
  }, 15000);

  it("should handle AI-related span prefixes", async () => {
    const tracer = trace.getTracer("test-service", "1.0.0");
    const aiPrefixes = [
      "gen_ai.completion",
      "llm.generate",
      "ai.model_call",
      "braintrust.eval",
      "traceloop.workflow",
    ];

    await tracer.startActiveSpan("ai_prefix_test_root", async (rootSpan) => {
      for (const prefix of aiPrefixes) {
        await tracer.startActiveSpan(prefix, async (aiSpan) => {
          aiSpan.setAttributes({
            "test.prefix": prefix,
            "test.type": "ai_span",
          });

          expect(aiSpan.spanContext().spanId).toBeTruthy();
          aiSpan.end();
        });
      }

      rootSpan.end();
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await testLogger.flush();
    const spans = await testLogger.drain();

    expect(spans.length).toBeGreaterThanOrEqual(6);

    const rootSpan = spans.find(
      (s: any) => s.span_attributes?.name === "ai_prefix_test_root",
    );
    expect(rootSpan).toBeDefined();

    for (const prefix of aiPrefixes) {
      const aiSpan = spans.find((s: any) => s.span_attributes?.name === prefix);
      expect(aiSpan).toBeDefined();
      expect(aiSpan.metadata?.["test.prefix"]).toBe(prefix);
      expect(aiSpan.metadata?.["test.type"]).toBe("ai_span");
    }
  }, 15000);

  it("should support parallel span creation", async () => {
    const tracer = trace.getTracer("test-service", "1.0.0");

    await tracer.startActiveSpan("parallel_test_root", async (rootSpan) => {
      const operations = Array.from({ length: 5 }, (_, i) => i);

      await Promise.all(
        operations.map(async (i) => {
          await tracer.startActiveSpan(`parallel_op_${i}`, async (span) => {
            span.setAttributes({
              "operation.id": i,
              "operation.type": "parallel",
            });

            await new Promise((resolve) => setTimeout(resolve, 100));

            span.end();
          });
        }),
      );

      rootSpan.end();
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await testLogger.flush();
    const spans = await testLogger.drain();

    expect(spans.length).toBeGreaterThanOrEqual(6);

    const rootSpan = spans.find(
      (s: any) => s.span_attributes?.name === "parallel_test_root",
    );
    expect(rootSpan).toBeDefined();

    const parallelSpans = spans.filter((s: any) =>
      s.span_attributes?.name?.startsWith("parallel_op_"),
    );
    expect(parallelSpans.length).toBe(5);

    parallelSpans.forEach((span: any) => {
      expect(span.metadata?.["operation.type"]).toBe("parallel");
      expect(typeof span.metadata?.["operation.id"]).toBe("number");
    });
  }, 15000);
});
