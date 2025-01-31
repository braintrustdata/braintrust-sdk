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
