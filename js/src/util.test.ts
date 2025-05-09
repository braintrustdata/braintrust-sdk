import { expect, test } from "vitest";
import { LazyValue } from "./util";

test("LazyValue evaluates exactly once", async () => {
  let callCount = 0;
  const lazy = new LazyValue(async () => {
    callCount++;
    return "test";
  });

  expect(callCount).toBe(0);
  expect(lazy.hasSucceeded).toBe(false);

  const promise1 = lazy.get();
  const promise2 = lazy.get();

  expect(callCount).toBe(1);
  expect(lazy.hasSucceeded).toBe(false);

  await promise1;
  await promise2;

  expect(callCount).toBe(1);
  expect(lazy.hasSucceeded).toBe(true);
});

test("LazyValue hasSucceeded only set after successful completion", async () => {
  const lazy = new LazyValue(async () => {
    throw new Error("test error");
  });

  expect(lazy.hasSucceeded).toBe(false);

  try {
    await lazy.get();
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    expect((e as Error).message).toBe("test error");
  }

  expect(lazy.hasSucceeded).toBe(false);
});

test("LazyValue caches successful result", async () => {
  const lazy = new LazyValue(async () => "test value");

  const result1 = await lazy.get();
  const result2 = await lazy.get();

  expect(result1).toBe("test value");
  expect(result2).toBe("test value");
  expect(lazy.hasSucceeded).toBe(true);
});

test("LazyValue getSync returns correct status through lifecycle", async () => {
  const lazy = new LazyValue(async () => "test value");

  // Before calling get()
  const resultBefore = lazy.getSync();
  expect(resultBefore.resolved).toBe(false);
  expect(resultBefore.value).toBeUndefined();

  // After calling get() but before resolution
  const promise = lazy.get();
  const resultDuring = lazy.getSync();
  expect(resultDuring.resolved).toBe(false);
  expect(resultDuring.value).toBeUndefined();

  // After resolution
  await promise;
  const resultAfter = lazy.getSync();
  expect(resultAfter.resolved).toBe(true);
  expect(resultAfter.value).toBe("test value");
});

test("LazyValue getSync works with objects", async () => {
  const testObj = { prop1: "value1", prop2: 42 };
  const lazy = new LazyValue(async () => testObj);

  // Get the promise and wait for it to resolve
  await lazy.get();

  // After resolution
  const resultAfter = lazy.getSync();
  expect(resultAfter.resolved).toBe(true);
  expect(resultAfter.value).toBe(testObj); // Same object reference
  expect(resultAfter.value?.prop1).toBe("value1");
  expect(resultAfter.value?.prop2).toBe(42);
});
