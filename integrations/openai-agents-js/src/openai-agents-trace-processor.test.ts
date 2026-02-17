import { assert, describe, test } from "vitest";
import { OpenAIAgentsTraceProcessor } from "./index";

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

describe("OpenAIAgentsTraceProcessor flush behavior", () => {
  test("onTraceEnd waits for root span flush to complete", async () => {
    let flushCalls = 0;
    let endCalls = 0;
    const deferred = createDeferredPromise();

    const rootSpan = {
      log: () => {},
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

    let onTraceEndResolved = false;
    const onTraceEndPromise = processor.onTraceEnd(trace).then(() => {
      onTraceEndResolved = true;
    });

    await Promise.resolve();

    assert.equal(endCalls, 1, "onTraceEnd should end the root span");
    assert.equal(flushCalls, 1, "onTraceEnd should flush the root span once");
    assert.isFalse(
      onTraceEndResolved,
      "onTraceEnd should not resolve before root span flush resolves",
    );

    deferred.resolve();
    await onTraceEndPromise;

    assert.isTrue(
      onTraceEndResolved,
      "onTraceEnd should resolve after root span flush resolves",
    );
    assert.isFalse(
      processor._traceSpans.has(trace.traceId),
      "onTraceEnd should remove trace state after finishing",
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
