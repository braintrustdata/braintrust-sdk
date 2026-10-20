import { _internalGetGlobalState, type Span } from "../../logger";

export type CloudflareThinkRun = {
  span: Span;
  startTelemetry: (
    input: unknown,
    metadata: Record<string, unknown>,
  ) => boolean;
  finishTelemetry: (
    output: unknown,
    metrics: Record<string, number>,
    error?: unknown,
  ) => void;
};

const cloudflareThinkSpans = new Map<string, CloudflareThinkRun>();

export function registerCloudflareThinkSpan(run: CloudflareThinkRun): void {
  if (run.span.spanId) {
    cloudflareThinkSpans.set(run.span.spanId, run);
  }
}

export function unregisterCloudflareThinkSpan(span: Span): void {
  if (span.spanId) {
    cloudflareThinkSpans.delete(span.spanId);
  }
}

export function currentCloudflareThinkRun(): CloudflareThinkRun | undefined {
  const parentSpanIds =
    _internalGetGlobalState()?.contextManager.getParentSpanIds()?.spanParents ??
    [];
  for (const parentSpanId of parentSpanIds) {
    const span = cloudflareThinkSpans.get(parentSpanId);
    if (span) {
      return span;
    }
  }
  return undefined;
}

export function cloudflareThinkSpanCountForTesting(): number {
  return cloudflareThinkSpans.size;
}
