export const TRANSACTION_ID_FIELD = "_xact_id";
export const IS_MERGE_FIELD = "_is_merge";

// Given a callback, runs the callback as a "finally" component. If
// `callback` returns a Promise, `finallyF` is chained to the promise. Otherwise,
// it is run afterwards synchronously.
export async function runFinally<R>(
  f: () => R | Promise<R>,
  finallyF: () => void | Promise<void>
): Promise<R> {
  try {
    let ret = f();
    if (ret instanceof Promise) {
      return await ret;
    } else {
      return ret;
    }
  } finally {
    const f = finallyF();
    if (f instanceof Promise) {
      await f;
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
