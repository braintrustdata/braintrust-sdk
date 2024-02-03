export const GLOBAL_PROJECT = "Global";

// Given a callback, runs the callback as a "finally" component. If
// `callback` returns a Promise, `finallyF` is chained to the promise. Otherwise,
// it is run afterwards synchronously.
export function runFinally<R>(f: () => R, finallyF: () => void): R {
  let runSyncCleanup = true;
  try {
    const ret = f();
    if (ret instanceof Promise) {
      runSyncCleanup = false;
      return (ret as any).finally(finallyF) as R;
    } else {
      return ret;
    }
  } finally {
    if (runSyncCleanup) {
      finallyF();
    }
  }
}

export function getCurrentUnixTimestamp(): number {
  return new Date().getTime() / 1000;
}

export function isEmpty(a: unknown): a is null | undefined {
  return a === undefined || a === null;
}

// A simple wrapper around a callable async function which computes the value
// on-demand and saves it for future retrievals. The difference between this and
// a bare Promise is that the async callable is run only when asked for. There
// should be no un-awaited promises floating around (as long as the user
// immediately consumes what is returned by `LazyValue.value()`).
export class LazyValue<T> {
  private callable: () => Promise<T>;
  private value: { hasComputed: true; val: T } | { hasComputed: false } = {
    hasComputed: false,
  };

  constructor(callable: () => Promise<T>) {
    this.callable = callable;
  }

  async get(): Promise<T> {
    if (this.value.hasComputed) {
      return this.value.val;
    }
    this.value = { hasComputed: true, val: await this.callable() };
    return this.value.val;
  }
}
