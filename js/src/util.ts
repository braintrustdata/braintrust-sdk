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
  private value:
    | { hasComputed: true; val: Promise<T> }
    | { hasComputed: false } = {
    hasComputed: false,
  };

  constructor(callable: () => Promise<T>) {
    this.callable = callable;
  }

  get(): Promise<T> {
    if (this.value.hasComputed) {
      return this.value.val;
    }
    // Note that we do not want to await the Promise returned by the callable
    // inside `get` before setting `hasComputed` to true, because that would
    // allow multiple async tasks to invoke `.get` concurrently and potentially
    // invoke `this.callable` multiple times. By keeping this method fully
    // synchronous, we guarantee that `callable` is only invoked once.
    this.value = { hasComputed: true, val: this.callable() };
    return this.value.val;
  }

  public get hasComputed(): boolean {
    return this.value.hasComputed;
  }
}

export function _urljoin(...parts: string[]): string {
  return parts
    .map((x, i) =>
      x.replace(/^\//, "").replace(i < parts.length - 1 ? /\/$/ : "", ""),
    )
    .join("/");
}
