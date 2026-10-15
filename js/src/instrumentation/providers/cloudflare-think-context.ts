import { _internalGetGlobalState, type Span } from "../../logger/core";

const THINK_SPANS = Symbol.for("braintrust.cloudflare-think.spans.v1");

// The AI SDK and Think consumers may be registered by different bundled copies.
// Keep their active spans together, just like the global instrumentation registry.
function getThinkSpans(): Map<string, Span> {
  const root = globalThis as typeof globalThis & {
    [THINK_SPANS]?: Map<string, Span>;
  };
  return (root[THINK_SPANS] ??= new Map());
}

export function registerCloudflareThinkSpan(span: Span): void {
  if (span.spanId) {
    getThinkSpans().set(span.spanId, span);
  }
}

export function unregisterCloudflareThinkSpan(span: Span): void {
  if (span.spanId) {
    getThinkSpans().delete(span.spanId);
  }
}

export function currentCloudflareThinkSpan(): Span | undefined {
  const parentSpanIds =
    _internalGetGlobalState()?.contextManager.getParentSpanIds()?.spanParents ??
    [];
  for (const parentSpanId of parentSpanIds) {
    const span = getThinkSpans().get(parentSpanId);
    if (span) {
      return span;
    }
  }
  return undefined;
}

export function cloudflareThinkSpanCountForTesting(): number {
  return getThinkSpans().size;
}
