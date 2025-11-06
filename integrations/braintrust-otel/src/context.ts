// Unified context management using OTEL's built-in context
import * as api from "@opentelemetry/api";
import { ContextManager, type ContextParentSpanIds, type Span } from "./types";

// Create context keys for Braintrust spans
export const BRAINTRUST_SPAN_KEY = api.createContextKey("braintrust_span");
export const BRAINTRUST_PARENT_KEY = api.createContextKey("braintrust.parent");

function isOtelSpan(span: unknown): span is {
  spanContext: () => { spanId: string; traceId: string };
} {
  return (
    typeof span === "object" &&
    span !== null &&
    "spanContext" in span &&
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

/**
 * Context manager that integrates Braintrust spans with OpenTelemetry.
 *
 * This manager allows Braintrust spans to participate in OpenTelemetry's
 * context propagation, enabling seamless integration with OTEL instrumentation.
 *
 * @example
 * ```typescript
 * import { setContextManager } from 'braintrust';
 * import { OtelContextManager } from '@braintrust/otel';
 *
 * // Set the OTEL context manager globally
 * setContextManager(new OtelContextManager());
 * ```
 */
export class OtelContextManager extends ContextManager {
  getParentSpanIds(): ContextParentSpanIds | undefined {
    const currentSpan = api.trace.getActiveSpan();
    if (!currentSpan || !isOtelSpan(currentSpan)) {
      return undefined;
    }

    const spanContext = currentSpan.spanContext();
    if (!isValidSpanContext(spanContext)) {
      return undefined;
    }

    const btSpan = api.context.active().getValue(BRAINTRUST_SPAN_KEY);
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
    // Store the BT span in OTEL context and wrap it in a NonRecordingSpan
    try {
      if (
        typeof span === "object" &&
        span !== null &&
        "spanId" in span &&
        "rootSpanId" in span
      ) {
        const btSpan = span as { spanId: string; rootSpanId: string };

        // Convert UUID format to hex format if needed (OTEL requires hex format)
        // UUIDs have dashes and are 36 chars, hex IDs are 16/32 chars without dashes
        const traceIdHex = btSpan.rootSpanId.replace(/-/g, "").padStart(32, "0");
        const spanIdHex = btSpan.spanId.replace(/-/g, "").padStart(16, "0");

        // Create a span context for the NonRecordingSpan
        const spanContext = {
          traceId: traceIdHex,
          spanId: spanIdHex,
          isRemote: false,
          traceFlags: api.TraceFlags.SAMPLED,
        };

        // Wrap the span context
        const wrappedContext = api.trace.wrapSpanContext(spanContext);

        // Get current context and add both the wrapped span and the BT span
        const currentContext = api.context.active();
        
        // Build the context chain: set span first, then add BT span value, then parent value
        let newContext = api.trace.setSpan(currentContext, wrappedContext);
        newContext = newContext.setValue(BRAINTRUST_SPAN_KEY, span);

        // Get parent value and store it in context (matching Python's behavior)
        const parentValue = (span as any)._getOtelParent?.();
        if (parentValue) {
          newContext = newContext.setValue(BRAINTRUST_PARENT_KEY, parentValue);
        }

        // Run the callback in the new context
        // api.context.with() properly handles async callbacks when AsyncLocalStorageContextManager is enabled
        return api.context.with(newContext, callback);
      }
    } catch (error) {
      console.warn("Failed to run in OTEL context:", error);
    }

    return callback();
  }

  getCurrentSpan(): Span | undefined {
    const btSpan = api.context.active().getValue(BRAINTRUST_SPAN_KEY);
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

