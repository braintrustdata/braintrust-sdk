import { aiSDKBatchChannels } from "./instrumentation/plugins/ai-sdk-batch-interceptors";
import type { AISDKBatchReference } from "./vendor-sdk-types/ai-sdk-batch";

/**
 * Export an opaque Braintrust context immediately after an instrumented batch
 * submission. Persist it alongside the AI SDK batch reference, then restore it
 * with `resumeAISDKBatchTrace` in the worker that retrieves the results.
 *
 * The context contains trace routing and request IDs/models, not prompts or
 * credentials. Treat it as trusted application state. Returns undefined when
 * the batch is not tracked or AI SDK instrumentation is disabled.
 */
export function exportAISDKBatchTrace(
  batch: AISDKBatchReference,
): Promise<string | undefined> {
  return aiSDKBatchChannels.exportTrace.invoke(
    async () => undefined,
    undefined,
    [batch],
    {},
  );
}

/**
 * Restore a persisted batch context before calling instrumented AI SDK status
 * or results functions in another process. This makes no provider requests.
 * Invalid contexts are ignored with an instrumentation diagnostic.
 *
 * Verify webhook signatures in application code before restoring trusted state
 * and fetching results. The webhook payload itself is not a trace context.
 */
export function resumeAISDKBatchTrace(context: string): Promise<void> {
  return aiSDKBatchChannels.resumeTrace.invoke(
    async () => undefined,
    undefined,
    [context],
    {},
  );
}
