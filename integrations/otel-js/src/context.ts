import {
  ContextManager,
  type ContextParentSpanIds,
  type Span,
} from "braintrust";

import { trace as otelTrace, context as otelContext } from "@opentelemetry/api";
import { BRAINTRUST_SPAN, BRAINTRUST_PARENT } from "./constants";

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
    const btSpan = otelContext?.active().getValue?.(BRAINTRUST_SPAN);
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
        newContext = newContext.setValue(BRAINTRUST_SPAN, span);

        // Set braintrust.parent in context so child OTEL spans can inherit it
        // Build parent string from span properties
        if (typeof span === "object" && span !== null) {
          // Use bracket notation to avoid type assertions
          const spanRecord = span as unknown as Record<string, unknown>;
          const parentComputeObjectMetadataArgs =
            spanRecord["parentComputeObjectMetadataArgs"];

          if (
            typeof parentComputeObjectMetadataArgs === "object" &&
            parentComputeObjectMetadataArgs !== null
          ) {
            const metadata =
              parentComputeObjectMetadataArgs as unknown as Record<
                string,
                unknown
              >;
            let parentStr = "";
            const projectName = metadata["project_name"];
            const projectId = metadata["project_id"];
            const experimentId = metadata["experiment_id"];

            if (typeof projectName === "string") {
              parentStr += `project_name:${projectName}`;
            } else if (typeof projectId === "string") {
              parentStr += `project_id:${projectId}`;
            }
            if (typeof experimentId === "string") {
              if (parentStr) parentStr += ":";
              parentStr += `experiment_id:${experimentId}`;
            }
            if (parentStr) {
              parentStr += `:span_id:${btSpan.spanId}`;
              const spanId = spanRecord["id"];
              if (typeof spanId === "string") {
                parentStr += `:row_id:${spanId}`;
              }
              newContext = newContext.setValue(BRAINTRUST_PARENT, parentStr);
            }
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
    const btSpan = otelContext.active().getValue?.(BRAINTRUST_SPAN);
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
