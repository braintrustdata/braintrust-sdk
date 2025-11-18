import {
  ContextManager,
  type ContextParentSpanIds,
  type Span,
} from "braintrust";

import { trace as otelTrace, context as otelContext } from "@opentelemetry/api";
import { getOtelParentFromSpan } from "./otel";

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
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const ctx = spanContext as { spanId: string; traceId: string };
  return (
    ctx.spanId !== "0000000000000000" &&
    ctx.traceId !== "00000000000000000000000000000000"
  );
}

export class OtelContextManager extends ContextManager {
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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const btSpan = otelContext?.active().getValue?.("braintrust_span" as any);
    if (
      btSpan &&
      currentSpan.constructor.name === "NonRecordingSpan" &&
      typeof btSpan === "object" &&
      btSpan !== null &&
      "rootSpanId" in btSpan &&
      "spanId" in btSpan
    ) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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
    try {
      if (
        typeof span === "object" &&
        span !== null &&
        "spanId" in span &&
        "rootSpanId" in span
      ) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
        newContext = newContext.setValue("braintrust_span" as any, span);

        // Get parent value and store it in context (matching Python's behavior)
        if (isBraintrustSpan(span)) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const parentValue = getOtelParentFromSpan(span as never);
          if (parentValue) {
            newContext = newContext.setValue(
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
              "braintrust.parent" as any,
              parentValue,
            );
          }
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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const btSpan = otelContext.active().getValue?.("braintrust_span" as any);

    if (
      btSpan &&
      typeof btSpan === "object" &&
      btSpan !== null &&
      "spanId" in btSpan &&
      "rootSpanId" in btSpan
    ) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return btSpan as Span;
    }
    return undefined;
  }
}
