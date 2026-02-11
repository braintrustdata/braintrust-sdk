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
