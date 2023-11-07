export const TRANSACTION_ID_FIELD = "_xact_id";
export const IS_MERGE_FIELD = "_is_merge";
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

// Mutably updates `mergeInto` with the contents of `mergeFrom`, merging objects deeply.
export function mergeDicts(
  mergeInto: Record<any, any>,
  mergeFrom: Record<any, any>
) {
  for (const [k, mergeFromV] of Object.entries(mergeFrom)) {
    const mergeIntoV = mergeInto[k];
    if (
      mergeIntoV instanceof Object &&
      !Array.isArray(mergeIntoV) &&
      mergeFrom instanceof Object &&
      !Array.isArray(mergeFromV)
    ) {
      mergeDicts(mergeIntoV, mergeFromV);
    } else {
      mergeInto[k] = mergeFromV;
    }
  }
}

export function getCurrentUnixTimestamp(): number {
  return new Date().getTime() / 1000;
}
