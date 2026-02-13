import { assert, describe, test } from "vitest";
import { OpenAIAgentsTraceProcessor } from "./index";
import type { AgentsSpan, AgentsTrace } from "./types";

function createDeferredPromise(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

class MockBraintrustSpan {
  public endCalls = 0;
  public readonly logs: Array<Record<string, unknown>> = [];

  startSpan(_args: { name: string; type: string }): MockBraintrustSpan {
    return new MockBraintrustSpan();
  }

  log(payload: Record<string, unknown>): void {
    this.logs.push(payload);
  }

  end(): void {
    this.endCalls += 1;
  }
}

function createTrace(traceId: string): AgentsTrace {
  return {
    type: "trace",
    traceId,
    name: "test-trace",
    groupId: null,
    metadata: {},
  };
}

function createGenerationSpan(
  traceId: string,
  spanId: string,
  parentId: string | null = null,
): AgentsSpan {
  return {
    type: "trace.span",
    traceId,
    spanId,
    parentId,
    startedAt: new Date().toISOString(),
    endedAt: new Date(Date.now() + 10).toISOString(),
    error: null,
    spanData: {
      type: "generation",
      input: [{ role: "user", content: "hello" }],
      output: [{ role: "assistant", content: "world" }],
    },
  };
}

function createProcessorWithMockLogger(): OpenAIAgentsTraceProcessor {
  return new OpenAIAgentsTraceProcessor({
    logger: {
      startSpan: () => new MockBraintrustSpan(),
      flush: async () => {},
    } as any,
  });
}

function requireTraceData(
  processor: OpenAIAgentsTraceProcessor,
  traceId: string,
): {
  rootSpan: unknown;
  childSpans: Map<string, unknown>;
  metadata: unknown;
} {
  const traceData = processor._traceSpans.get(traceId);
  if (!traceData) {
    throw new Error(`Expected trace data for traceId=${traceId}`);
  }
  return traceData as unknown as {
    rootSpan: unknown;
    childSpans: Map<string, unknown>;
    metadata: unknown;
  };
}

function requireChildSpan(
  traceData: { childSpans: Map<string, unknown> },
  spanId: string,
): MockBraintrustSpan {
  const span = traceData.childSpans.get(spanId);
  if (!span) {
    throw new Error(`Expected child span for spanId=${spanId}`);
  }
  return span as MockBraintrustSpan;
}

describe("OpenAIAgentsTraceProcessor flush behavior", () => {
  test("forceFlush waits for logger.flush to complete", async () => {
    let flushCalls = 0;
    const deferred = createDeferredPromise();

    const processor = new OpenAIAgentsTraceProcessor({
      logger: {
        flush: () => {
          flushCalls += 1;
          return deferred.promise;
        },
      } as any,
    });

    let forceFlushResolved = false;
    const forceFlushPromise = processor.forceFlush().then(() => {
      forceFlushResolved = true;
    });

    await Promise.resolve();

    assert.equal(
      flushCalls,
      1,
      "forceFlush should call logger.flush exactly once",
    );
    assert.isFalse(
      forceFlushResolved,
      "forceFlush should not resolve before logger.flush resolves",
    );

    deferred.resolve();
    await forceFlushPromise;

    assert.isTrue(
      forceFlushResolved,
      "forceFlush should resolve after logger.flush",
    );
  });

  test("shutdown waits for logger.flush to complete", async () => {
    let flushCalls = 0;
    const deferred = createDeferredPromise();

    const processor = new OpenAIAgentsTraceProcessor({
      logger: {
        flush: () => {
          flushCalls += 1;
          return deferred.promise;
        },
      } as any,
    });

    let shutdownResolved = false;
    const shutdownPromise = processor.shutdown().then(() => {
      shutdownResolved = true;
    });

    await Promise.resolve();

    assert.equal(
      flushCalls,
      1,
      "shutdown should call logger.flush exactly once",
    );
    assert.isFalse(
      shutdownResolved,
      "shutdown should not resolve before logger.flush resolves",
    );

    deferred.resolve();
    await shutdownPromise;

    assert.isTrue(
      shutdownResolved,
      "shutdown should resolve after logger.flush",
    );
  });
});

describe("OpenAIAgentsTraceProcessor span race handling", () => {
  test("child spans are ended when onTraceEnd runs before onSpanEnd", async () => {
    const processor = createProcessorWithMockLogger();
    const trace = createTrace("race-trace-1");
    const span = createGenerationSpan(trace.traceId, "race-span-1");

    await processor.onTraceStart(trace);
    await processor.onSpanStart(span);

    const traceData = requireTraceData(processor, trace.traceId);
    const childSpan = requireChildSpan(traceData, span.spanId);
    assert.equal(childSpan.endCalls, 0, "Child span should start unended");

    await processor.onTraceEnd(trace);

    assert.equal(
      childSpan.endCalls,
      1,
      "Child span should be ended when trace ends first",
    );
    assert.isFalse(
      processor._traceSpans.has(trace.traceId),
      "Trace data should be cleaned up after onTraceEnd",
    );
  });

  test("onSpanEnd after onTraceEnd is a safe no-op", async () => {
    const processor = createProcessorWithMockLogger();
    const trace = createTrace("race-trace-2");
    const span = createGenerationSpan(trace.traceId, "race-span-2");

    await processor.onTraceStart(trace);
    await processor.onSpanStart(span);

    const traceData = requireTraceData(processor, trace.traceId);
    const childSpan = requireChildSpan(traceData, span.spanId);

    await processor.onTraceEnd(trace);
    assert.equal(
      childSpan.endCalls,
      1,
      "Child span should be ended by trace end",
    );

    await processor.onSpanEnd(span);

    assert.equal(
      childSpan.endCalls,
      1,
      "Late onSpanEnd should not fail or double-end the span",
    );
  });

  test("multiple child spans are all ended when onTraceEnd runs first", async () => {
    const processor = createProcessorWithMockLogger();
    const trace = createTrace("race-trace-3");
    const spanA = createGenerationSpan(trace.traceId, "span-a");
    const spanB = createGenerationSpan(trace.traceId, "span-b");
    const spanC = createGenerationSpan(trace.traceId, "span-c", spanB.spanId);

    await processor.onTraceStart(trace);
    await processor.onSpanStart(spanA);
    await processor.onSpanStart(spanB);
    await processor.onSpanStart(spanC);

    const traceData = requireTraceData(processor, trace.traceId);
    const childSpanA = requireChildSpan(traceData, spanA.spanId);
    const childSpanB = requireChildSpan(traceData, spanB.spanId);
    const childSpanC = requireChildSpan(traceData, spanC.spanId);

    // End one span through the normal path to verify trace end only closes remaining spans.
    await processor.onSpanEnd(spanA);
    assert.equal(
      childSpanA.endCalls,
      1,
      "Span A should be ended once normally",
    );

    await processor.onTraceEnd(trace);

    assert.equal(
      childSpanA.endCalls,
      1,
      "Span A should not be double-ended on trace end",
    );
    assert.equal(
      childSpanB.endCalls,
      1,
      "Span B should be ended by onTraceEnd",
    );
    assert.equal(
      childSpanC.endCalls,
      1,
      "Span C should be ended by onTraceEnd",
    );
  });
});
