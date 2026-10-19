import iso, { type IsoAsyncLocalStorage } from "../isomorph";

const LOG_CONTEXT = Symbol.for("braintrust.applicationLogContext");
type LogContext = { store?: IsoAsyncLocalStorage<boolean>; depth: number };

function context(): LogContext {
  // Shared across SDK copies so wrappers cannot capture another copy's transport logs.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const global = globalThis as typeof globalThis & {
    [LOG_CONTEXT]?: LogContext;
  };
  const current = (global[LOG_CONTEXT] ??= { depth: 0 });
  // Bootstrap diagnostics use synchronous suppression until platform-specific
  // async context storage is available. Do not cache the no-op default store.
  if (!current.store && iso.buildType !== "unknown") {
    current.store = iso.newAsyncLocalStorage<boolean>();
  }
  return current;
}

export function isApplicationLogSuppressed(): boolean {
  const current = context();
  return current.depth > 0 || current.store?.getStore() === true;
}

export function suppressApplicationLogs<R>(callback: () => R): R {
  const current = context();
  current.depth++;
  try {
    return current.store ? current.store.run(true, callback) : callback();
  } finally {
    current.depth--;
  }
}

export function internalFetch(
  fetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return (...args) => suppressApplicationLogs(() => fetch(...args));
}
