export const GLOBAL_PROJECT = "Global";

// Given a function to execute, a catch handler, and a finally handler, runs the function and
// executes the catch handler if an error occurs. If the function returns a Promise, the finally handler
// is chained to the promise. Otherwise, it is run afterwards synchronously.
export function runCatchFinally<R>(
  f: () => R,
  catchF: (e: unknown) => R,
  finallyF: () => void,
): R {
  let runSyncCleanup = true;
  try {
    const ret = f();
    if (ret instanceof Promise) {
      runSyncCleanup = false;
      return (ret as any).catch(catchF).finally(finallyF) as R;
    } else {
      return ret;
    }
  } catch (e) {
    return catchF(e);
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
    | { computedState: "succeeded"; val: Promise<T> }
    | { computedState: "in_progress"; val: Promise<T> }
    | { computedState: "uninitialized" } = {
    computedState: "uninitialized",
  };

  constructor(callable: () => Promise<T>) {
    this.callable = callable;
  }

  get(): Promise<T> {
    if (this.value.computedState !== "uninitialized") {
      return this.value.val;
    }
    // Note that we do not want to await the Promise returned by the callable
    // inside `get` before updating `computedState`, because that would allow
    // multiple async tasks to invoke `.get` concurrently and potentially invoke
    // `this.callable` multiple times. By keeping this method fully synchronous,
    // we guarantee that `callable` is only invoked once.
    //
    // Once the callable completes successfully, we update the computedState to
    // "succeeded".
    this.value = {
      computedState: "in_progress",
      val: this.callable().then((x) => {
        this.value.computedState = "succeeded";
        return x;
      }),
    };
    return this.value.val;
  }

  // If this is true, the caller should be able to obtain the LazyValue without
  // it throwing.
  public get hasSucceeded(): boolean {
    return this.value.computedState === "succeeded";
  }
}
