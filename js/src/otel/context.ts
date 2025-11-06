// Unified context management using OTEL's built-in context

import * as otelApi from "@opentelemetry/api";

import {
  ContextManager,
  type ContextParentSpanIds,
  type SpanForContext,
} from "../context-manager";

const BRAINTRUST_SPAN_KEY = Symbol.for("braintrust_span");
export const BRAINTRUST_PARENT_KEY = Symbol.for("braintrust.parent");

const otelTrace = otelApi.trace;
const otelContext = otelApi.context;

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

class OtelContextManagerImpl extends ContextManager {
  constructor() {
    super();
  }

  getParentSpanIds(): ContextParentSpanIds | undefined {
    const currentSpan = otelTrace.getActiveSpan();
    if (!currentSpan || !isOtelSpan(currentSpan)) {
      return undefined;
    }

    const spanContext = currentSpan.spanContext();
    if (!isValidSpanContext(spanContext)) {
      return undefined;
    }

    // Check if this is a wrapped BT span
    const btSpan = otelContext?.active().getValue?.(BRAINTRUST_SPAN_KEY);
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

  runInContext<R>(span: SpanForContext, callback: () => R): R {
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
        newContext = newContext.setValue(BRAINTRUST_SPAN_KEY, span);

        // Get parent value and store it in context (matching Python's behavior)
        const parentValue = span._getOtelParent?.();
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

  getCurrentSpan(): SpanForContext | undefined {
    const btSpan = otelContext.active().getValue?.(BRAINTRUST_SPAN_KEY);
    if (
      btSpan &&
      typeof btSpan === "object" &&
      btSpan !== null &&
      "spanId" in btSpan &&
      "rootSpanId" in btSpan
    ) {
      return btSpan as SpanForContext;
    }
    return undefined;
  }
}

export function createOtelContextManager(): ContextManager {
  return new OtelContextManagerImpl();
}
