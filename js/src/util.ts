// Given a callback, runs the callback as a "finally" component. If
// `callback` returns a Promise, `finallyF` is chained to the promise. Otherwise,
// it is run afterwards synchronously.
export function runFinally<R>(f: () => R, finallyF: () => void): R {
  let runSyncCleanup = true;
  try {
    const ret = f();
    // There's no "blessed" way to detect whether an object is a
    // Promise-like object in javascript. So we use duck typing.
    if (
      ret instanceof Object &&
      "then" in ret &&
      ret.then instanceof Function &&
      "catch" in ret &&
      ret.catch instanceof Function &&
      "finally" in ret &&
      ret.finally instanceof Function
    ) {
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
