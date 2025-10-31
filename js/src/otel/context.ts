// Unified context management using OTEL's built-in context

import {
  ContextManager,
  type ContextParentSpanIds,
  type Span,
} from "../context-manager";
import { importWithTimeout } from "../import-utils";

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
  getValue?: (key: string) => unknown;
  setValue: (key: string, value: unknown, ctx?: Context) => Context;
  deleteValue: (key: string) => Context;
}

let otelTrace: OtelTrace | null = null;
let otelContext: OtelContext | null = null;
let OTEL_AVAILABLE: boolean | null = null; // null = not checked yet, true = available, false = not available
let otelInitPromise: Promise<void> | null = null;

function setOtelContextModules(otelApi: {
  trace: unknown;
  context: unknown;
}): void {
  otelTrace = otelApi.trace as unknown as OtelTrace;
  otelContext = otelApi.context as unknown as OtelContext;
  OTEL_AVAILABLE = true;
}

function handleOtelContextImportFailure(): void {
  console.warn(OTEL_NOT_INSTALLED_MESSAGE);
  OTEL_AVAILABLE = false;
}

function ensureOtelContextLoadedSync(): void {
  if (OTEL_AVAILABLE !== null) {
    return;
  }

  if (otelInitPromise) {
    return;
  }

  // CommonJS/Node.js: Load via synchronous require()
  if (typeof require !== "undefined") {
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

  // ESM: async import() for this module
  otelInitPromise = (async () => {
    try {
      const otelApi = await importWithTimeout<{
        trace: unknown;
        context: unknown;
      }>(
        () => import("@opentelemetry/api"),
        3000,
        "OpenTelemetry API import timeout",
      );

      setOtelContextModules(otelApi);
    } catch {
      handleOtelContextImportFailure();
    }
  })();
}

function checkOtelContextAvailableOrThrow(): void {
  if (OTEL_AVAILABLE === null) {
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
        const parentValue = span._getOtelParent();
        if (parentValue) {
          newContext = newContext.setValue("braintrust.parent", parentValue);
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
