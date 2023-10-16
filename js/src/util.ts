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
