// Unified context management using OTEL's built-in context

import {
  ContextManager,
  type ContextParentSpanIds,
  type Span,
} from "../context-manager";
import { BRAINTRUST_PARENT_KEY } from "./constants";

const OTEL_NOT_INSTALLED_MESSAGE =
  "OpenTelemetry packages are not installed. " +
  "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base";

const OTEL_STILL_LOADING_MESSAGE =
  "OpenTelemetry packages are still loading (pure ESM environment detected). " +
  "Please ensure @opentelemetry packages are installed, or add a small delay after import. " +
  "This only affects pure ESM environments; CommonJS/Node.js loads instantly.";

interface OtelTrace {
  getActiveSpan: () => unknown;
  wrapSpanContext: (spanContext: unknown) => unknown;
  setSpan: (ctx: Context, span: unknown) => Context;
}

interface OtelContext {
  active: () => Context;
  with: <T>(context: Context, fn: () => T) => T;
}

interface Context {
  getValue?: (key: string | symbol) => unknown;
  setValue: (key: string | symbol, value: unknown, ctx?: Context) => Context;
  deleteValue: (key: string) => Context;
}

// Use a global object to ensure state is shared across all module instances
// This is necessary because ESM test environments can create separate module instances
const OTEL_CONTEXT_STATE = (globalThis as any)
  .__BRAINTRUST_OTEL_CONTEXT_STATE || {
  otelTrace: null as OtelTrace | null,
  otelContext: null as OtelContext | null,
  OTEL_AVAILABLE: null as boolean | null,
  otelInitPromise: null as Promise<void> | null,
  preInitInProgress: null as Promise<void> | null,
};
(globalThis as any).__BRAINTRUST_OTEL_CONTEXT_STATE = OTEL_CONTEXT_STATE;

let otelTrace = OTEL_CONTEXT_STATE.otelTrace;
let otelContext = OTEL_CONTEXT_STATE.otelContext;
let OTEL_AVAILABLE = OTEL_CONTEXT_STATE.OTEL_AVAILABLE;
let otelInitPromise = OTEL_CONTEXT_STATE.otelInitPromise;
let preInitInProgress = OTEL_CONTEXT_STATE.preInitInProgress;

function setOtelContextModules(otelApi: {
  trace: unknown;
  context: unknown;
}): void {
  const state = OTEL_CONTEXT_STATE;
  state.otelTrace = otelApi.trace as unknown as OtelTrace;
  state.otelContext = otelApi.context as unknown as OtelContext;
  state.OTEL_AVAILABLE = true;
  state.preInitInProgress = null;

  // Update local references
  otelTrace = state.otelTrace;
  otelContext = state.otelContext;
  OTEL_AVAILABLE = state.OTEL_AVAILABLE;
  preInitInProgress = state.preInitInProgress;
}

/**
 * Pre-initialize OTEL context modules for ESM environments.
 * This is separate from the main OTEL loader because context manager has its own loading logic.
 *
 * Can be called multiple times safely - subsequent calls will resolve immediately.
 */
export async function preInitializeOtelContext(otelApi: {
  trace: unknown;
  context: unknown;
}): Promise<void> {
  // If already initialized, return immediately
  if (OTEL_AVAILABLE === true) {
    return;
  }

  // If initialization is in progress, wait for it
  if (preInitInProgress) {
    await preInitInProgress;
    return;
  }

  // Set modules directly (synchronously) then clear the flag
  setOtelContextModules(otelApi);
  preInitInProgress = null;
}

/**
 * Synchronously initialize OTEL context modules for CommonJS environments.
 * This is used when we can't use async/await (e.g., in synchronous require() context).
 */
export function preInitializeOtelContextSync(otelApi: {
  trace: unknown;
  context: unknown;
}): void {
  // If already initialized, return immediately
  if (OTEL_AVAILABLE === true) {
    return;
  }

  // For CommonJS, set modules directly (synchronously)
  setOtelContextModules(otelApi);
}

function handleOtelContextImportFailure(): void {
  console.warn(OTEL_NOT_INSTALLED_MESSAGE);
  const state = OTEL_CONTEXT_STATE;
  state.OTEL_AVAILABLE = false;
  OTEL_AVAILABLE = false;
}

function ensureOtelContextLoadedSync(): void {
  // Sync local references with global state
  const state = OTEL_CONTEXT_STATE;
  otelTrace = state.otelTrace;
  otelContext = state.otelContext;
  OTEL_AVAILABLE = state.OTEL_AVAILABLE;
  otelInitPromise = state.otelInitPromise;
  preInitInProgress = state.preInitInProgress;

  // If OTEL is already available (pre-initialized or loaded), we're done
  if (OTEL_AVAILABLE === true) {
    return;
  }

  // If OTEL is known to be unavailable, don't try again
  if (OTEL_AVAILABLE === false) {
    return;
  }

  // If preInitializeOtel is initializing, we need to wait for it to complete
  // However, we can't await in a sync function, so we'll set up a promise
  // and checkOtelContextAvailableOrThrow will handle the error if it's not ready
  if (preInitInProgress) {
    // Set otelInitPromise to the pre-init promise so we track it
    if (!otelInitPromise) {
      state.otelInitPromise = preInitInProgress;
      otelInitPromise = preInitInProgress;
    }
    return;
  }

  // If we're already in the process of loading, wait for that
  if (otelInitPromise) {
    return;
  }

  // In ESM environments, pre-initialization is required
  // If we get here and require() is not available, it means we're in ESM
  // and pre-initialization should have been called but wasn't
  if (typeof require === "undefined") {
    // Don't try async import in sync function - let checkOtelContextAvailableOrThrow handle it
    return;
  }

  // CommonJS/Node.js: Load via synchronous require()
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- Synchronous dynamic require
    const otelApi = require("@opentelemetry/api");

    setOtelContextModules(otelApi);
    return;
  } catch {
    handleOtelContextImportFailure();
    return;
  }
}

function checkOtelContextAvailableOrThrow(): void {
  // Sync local references with global state before checking
  const state = OTEL_CONTEXT_STATE;
  OTEL_AVAILABLE = state.OTEL_AVAILABLE;
  preInitInProgress = state.preInitInProgress;

  if (OTEL_AVAILABLE === null) {
    // If pre-init is in progress, provide a more helpful error message
    if (preInitInProgress) {
      throw new Error(
        OTEL_STILL_LOADING_MESSAGE +
          " preInitializeOtel() is still initializing. Ensure you await preInitializeOtel() before using Braintrust OTEL features.",
      );
    }
    throw new Error(OTEL_STILL_LOADING_MESSAGE);
  }

  if (!OTEL_AVAILABLE) {
    throw new Error(OTEL_NOT_INSTALLED_MESSAGE);
  }
}

function isOtelSpan(span: unknown): span is {
  spanContext: () => { spanId: string; traceId: string };
} {
  return (
    typeof span === "object" &&
    span !== null &&
    "spanContext" in span &&
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Type guard ensures object has property
    typeof (span as { spanContext?: unknown }).spanContext === "function"
  );
}

function isValidSpanContext(spanContext: unknown): boolean {
  if (
    !spanContext ||
    typeof spanContext !== "object" ||
    !("spanId" in spanContext) ||
    !("traceId" in spanContext)
  ) {
    return false;
  }
  const ctx = spanContext as { spanId: string; traceId: string };
  return (
    ctx.spanId !== "0000000000000000" &&
    ctx.traceId !== "00000000000000000000000000000000"
  );
}

export class OtelContextManager extends ContextManager {
  constructor() {
    super();
    ensureOtelContextLoadedSync();
    checkOtelContextAvailableOrThrow();
  }

  getParentSpanIds(): ContextParentSpanIds | undefined {
    // Sync with global state
    const state = OTEL_CONTEXT_STATE;
    otelTrace = state.otelTrace;
    otelContext = state.otelContext;
    OTEL_AVAILABLE = state.OTEL_AVAILABLE;

    if (!otelTrace || !otelContext || OTEL_AVAILABLE !== true) return undefined;

    const currentSpan = otelTrace.getActiveSpan();
    if (!currentSpan || !isOtelSpan(currentSpan)) {
      return undefined;
    }

    const spanContext = currentSpan.spanContext();
    if (!isValidSpanContext(spanContext)) {
      return undefined;
    }

    // Check if this is a wrapped BT span
    const btSpan = otelContext.active().getValue?.("braintrust_span");
    if (
      btSpan &&
      currentSpan.constructor.name === "NonRecordingSpan" &&
      typeof btSpan === "object" &&
      btSpan !== null &&
      "rootSpanId" in btSpan &&
      "spanId" in btSpan
    ) {
      const typedBtSpan = btSpan as { rootSpanId: string; spanId: string };
      return {
        rootSpanId: typedBtSpan.rootSpanId,
        spanParents: [typedBtSpan.spanId],
      };
    }

    // Otherwise use OTEL span IDs
    const otelTraceId = spanContext.traceId.toString().padStart(32, "0");
    const otelSpanId = spanContext.spanId.toString().padStart(16, "0");
    return {
      rootSpanId: otelTraceId,
      spanParents: [otelSpanId],
    };
  }

  runInContext<R>(span: Span, callback: () => R): R {
    // Sync with global state
    const state = OTEL_CONTEXT_STATE;
    otelTrace = state.otelTrace;
    otelContext = state.otelContext;
    OTEL_AVAILABLE = state.OTEL_AVAILABLE;

    if (!otelTrace || !otelContext || OTEL_AVAILABLE !== true) {
      return callback();
    }

    // Store the BT span in OTEL context and wrap it in a NonRecordingSpan
    try {
      if (
        typeof span === "object" &&
        span !== null &&
        "spanId" in span &&
        "rootSpanId" in span
      ) {
        const btSpan = span as { spanId: string; rootSpanId: string };

        // Create a span context for the NonRecordingSpan
        const spanContext = {
          traceId: btSpan.rootSpanId,
          spanId: btSpan.spanId,
          traceFlags: 1, // sampled
        };

        // Wrap the span context
        const wrappedContext = otelTrace.wrapSpanContext(spanContext);

        // Get current context and add both the wrapped span and the BT span
        const currentContext = otelContext.active();
        let newContext = otelTrace.setSpan(currentContext, wrappedContext);
        newContext = newContext.setValue("braintrust_span", span);

        // Get parent value and store it in context (matching Python's behavior)
        // Use the Symbol key so BraintrustSpanProcessor can find it
        const parentValue = span._getOtelParent();
        if (parentValue) {
          newContext = newContext.setValue(BRAINTRUST_PARENT_KEY, parentValue);
        }

        // Run the callback in the new context
        return otelContext.with(newContext, callback);
      }
    } catch (error) {
      console.warn("Failed to run in OTEL context:", error);
    }

    return callback();
  }

  getCurrentSpan(): Span | undefined {
    // Sync with global state
    const state = OTEL_CONTEXT_STATE;
    OTEL_AVAILABLE = state.OTEL_AVAILABLE;
    otelContext = state.otelContext;

    if (!otelContext || OTEL_AVAILABLE !== true) return undefined;

    const btSpan = otelContext.active().getValue?.("braintrust_span");
    if (
      btSpan &&
      typeof btSpan === "object" &&
      btSpan !== null &&
      "spanId" in btSpan &&
      "rootSpanId" in btSpan
    ) {
      return btSpan as Span;
    }
    return undefined;
  }
}
