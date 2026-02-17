import { assert, describe, test } from "vitest";
import { OpenAIAgentsTraceProcessor } from "./index";

function createDeferredPromise<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function trackAsyncCompletion<T>(promise: Promise<T>): {
  promise: Promise<T>;
  isResolved: () => boolean;
} {
  let resolved = false;
  return {
    promise: promise.finally(() => {
      resolved = true;
    }),
    isResolved: () => resolved,
  };
}

describe("OpenAIAgentsTraceProcessor flush behavior", () => {
  test("onTraceEnd waits for root span flush to complete", async () => {
    let flushCalls = 0;
    let endCalls = 0;
    const deferred = createDeferredPromise();
    let rootSpanInput: unknown;
    let rootSpanOutput: unknown;

    const childSpan = {
      log: () => {},
      end: () => {},
    };

    const rootSpan = {
      log: (data: Record<string, unknown>) => {
        rootSpanInput = data.input;
        rootSpanOutput = data.output;
      },
      startSpan: () => childSpan,
      end: () => {
        endCalls += 1;
      },
      flush: () => {
        flushCalls += 1;
        return deferred.promise;
      },
    };

    const processor = new OpenAIAgentsTraceProcessor({
      logger: {
        startSpan: () => rootSpan,
      } as any,
    });

    const trace = {
      traceId: "trace-1",
      name: "test-trace",
      groupId: "group-1",
      metadata: {},
    } as any;

    await processor.onTraceStart(trace);

    const childOpenAIAgentsSpan = {
      spanId: "span-1",
      traceId: trace.traceId,
      spanData: {
        type: "generation",
        input: "first-input",
        output: "last-output",
      },
      error: null,
    } as any;
    await processor.onSpanStart(childOpenAIAgentsSpan);
    await processor.onSpanEnd(childOpenAIAgentsSpan);

    const onTraceEndCompletion = trackAsyncCompletion(processor.onTraceEnd(trace));

    await Promise.resolve();

    assert.equal(endCalls, 1, "onTraceEnd should end the root span");
    assert.equal(flushCalls, 1, "onTraceEnd should flush the root span once");
    assert.equal(rootSpanInput, "first-input", "onTraceEnd should log first input");
    assert.equal(
      rootSpanOutput,
      "last-output",
      "onTraceEnd should log last output",
    );
    assert.isFalse(
      onTraceEndCompletion.isResolved(),
      "onTraceEnd should not resolve before root span flush resolves",
    );

    deferred.resolve();
    await onTraceEndCompletion.promise;

    assert.isTrue(
      onTraceEndCompletion.isResolved(),
      "onTraceEnd should resolve after root span flush resolves",
    );
    assert.isFalse(
      processor._traceSpans.has(trace.traceId),
      "onTraceEnd should remove trace state after finishing",
    );
  });

  test("onTraceEnd propagates root span flush failure after cleanup", async () => {
    let flushCalls = 0;
    let endCalls = 0;
    const deferred = createDeferredPromise<void>();
    const failure = new Error("flush failed");
    let rootSpanInput: unknown;
    let rootSpanOutput: unknown;

    const childSpan = {
      log: () => {},
      end: () => {},
    };

    const rootSpan = {
      log: (data: Record<string, unknown>) => {
        rootSpanInput = data.input;
        rootSpanOutput = data.output;
      },
      startSpan: () => childSpan,
      end: () => {
        endCalls += 1;
      },
      flush: () => {
        flushCalls += 1;
        return deferred.promise;
      },
    };

    const processor = new OpenAIAgentsTraceProcessor({
      logger: {
        startSpan: () => rootSpan,
      } as any,
    });

    const trace = {
      traceId: "trace-2",
      name: "test-trace-fail",
      groupId: "group-1",
      metadata: {},
    } as any;

    await processor.onTraceStart(trace);

    const childOpenAIAgentsSpan = {
      spanId: "span-1",
      traceId: trace.traceId,
      spanData: {
        type: "generation",
        input: "first-input",
        output: "last-output",
      },
      error: null,
    } as any;
    await processor.onSpanStart(childOpenAIAgentsSpan);
    await processor.onSpanEnd(childOpenAIAgentsSpan);

    const onTraceEndCompletion = trackAsyncCompletion(processor.onTraceEnd(trace));

    await Promise.resolve();

    assert.equal(endCalls, 1, "onTraceEnd should end the root span");
    assert.equal(flushCalls, 1, "onTraceEnd should flush the root span once");
    assert.equal(rootSpanInput, "first-input", "root span log should include first input");
    assert.equal(
      rootSpanOutput,
      "last-output",
      "root span log should include last output",
    );
    assert.isFalse(
      onTraceEndCompletion.isResolved(),
      "onTraceEnd should wait for root span flush promise",
    );

    deferred.reject(failure);
    await assert.rejects(onTraceEndCompletion.promise, /flush failed/);

    assert.isFalse(
      processor._traceSpans.has(trace.traceId),
      "onTraceEnd should remove trace state even when flush fails",
    );
  });

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

    const forceFlushCompletion = trackAsyncCompletion(processor.forceFlush());

    await Promise.resolve();

    assert.equal(
      flushCalls,
      1,
      "forceFlush should call logger.flush exactly once",
    );
    assert.isFalse(
      forceFlushCompletion.isResolved(),
      "forceFlush should not resolve before logger.flush resolves",
    );

    deferred.resolve();
    await forceFlushCompletion.promise;

    assert.isTrue(
      forceFlushCompletion.isResolved(),
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

    const shutdownCompletion = trackAsyncCompletion(processor.shutdown());

    await Promise.resolve();

    assert.equal(
      flushCalls,
      1,
      "shutdown should call logger.flush exactly once",
    );
    assert.isFalse(
      shutdownCompletion.isResolved(),
      "shutdown should not resolve before logger.flush resolves",
    );

    deferred.resolve();
    await shutdownCompletion.promise;

    assert.isTrue(
      shutdownCompletion.isResolved(),
      "shutdown should resolve after logger.flush",
    );
  });
});
