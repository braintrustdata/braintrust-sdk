// Unified context management using OTEL's built-in context

import {
  ContextManager,
  type ContextParentSpanIds,
  type Span,
} from "../context-manager";
import { BRAINTRUST_PARENT_KEY } from "./constants";
import { getOtelApi, OTEL_NOT_INSTALLED_MESSAGE, type OtelApi } from "../otel-loader";

type OtelTraceAPI = NonNullable<OtelApi["trace"]>;
type OtelContextAPI = NonNullable<OtelApi["context"]>;

let cachedApi: OtelApi | null = null;

/**
 * Get OTEL API from the main loader, throws if OTEL is not available.
 */
function getOtelModules(): { trace: OtelTraceAPI; context: OtelContextAPI } {
  if (!cachedApi) {
    cachedApi = getOtelApi();
  }

  if (!cachedApi || !cachedApi.trace || !cachedApi.context) {
    throw new Error(OTEL_NOT_INSTALLED_MESSAGE);
  }

  return {
    trace: cachedApi.trace,
    context: cachedApi.context,
  };
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
  getParentSpanIds(): ContextParentSpanIds | undefined {
    try {
      const { trace, context } = getOtelModules();
      
      // Get current context and active span
      const ctx = context.active();
      const currentSpan = trace.getSpan(ctx);
      if (!currentSpan || !isOtelSpan(currentSpan)) {
        return undefined;
      }

      const spanContext = currentSpan.spanContext();
      if (!isValidSpanContext(spanContext)) {
        return undefined;
      }

      // Check if this is a wrapped BT span
      const btSpan = (ctx as any).getValue?.("braintrust_span");
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
    } catch {
      // OTEL not available, return undefined
      return undefined;
    }
  }

  runInContext<R>(span: Span, callback: () => R): R {
    try {
      const { trace, context } = getOtelModules();

      // Store the BT span in OTEL context and wrap it in a NonRecordingSpan
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
        const wrappedContext = trace.wrapSpanContext(spanContext);

        // Get current context and add both the wrapped span and the BT span
        const currentContext = context.active();
        let newContext = trace.setSpan(currentContext, wrappedContext);
        newContext = (newContext as any).setValue("braintrust_span", span);

        // Get parent value and store it in context (matching Python's behavior)
        // Use the Symbol key so BraintrustSpanProcessor can find it
        const parentValue = span._getOtelParent();
        if (parentValue) {
          newContext = newContext.setValue(BRAINTRUST_PARENT_KEY, parentValue);
        }

        // Run the callback in the new context
        // The context module has a `with` method at runtime (not in type definition)
        const contextWithWith = context as unknown as { 
          active: () => any; 
          with: <T>(ctx: any, fn: () => T) => T;
        };
        return contextWithWith.with(newContext, callback);
      }
    } catch (error) {
      // OTEL not available or error - just run callback normally
      console.warn("Failed to run in OTEL context:", error);
    }

    return callback();
  }

  getCurrentSpan(): Span | undefined {
    try {
      const { context } = getOtelModules();

      const btSpan = (context.active() as any).getValue?.("braintrust_span");
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
    } catch {
      // OTEL not available
      return undefined;
    }
  }
}
