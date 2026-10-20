import { isObject, SpanTypeAttribute } from "../../../util";
import { SpanComponentsV4 } from "../../../util/span_identifier_v4";
import { debugLogger } from "../../debug-logger";
import {
  _internalStartSpanWithInitialMerge,
  _internalStartSpanWithInitialMergeAndParentSpanIds,
  getSpanParentObject,
  NOOP_SPAN,
  startSpan,
  withCurrent,
  type Span,
} from "../../logger";
import {
  INSTRUMENTATION_NAMES,
  withSpanInstrumentationName,
} from "../../span-origin";
import { getCurrentUnixTimestamp } from "../../util";
import type {
  AISDKBatchAPI,
  AISDKBatchItem,
  AISDKBatchReference,
  AISDKBatchStatus,
  AISDKStartBatchOptions,
} from "../../vendor-sdk-types/ai-sdk-batch";
import {
  isAutoInstrumentationSuppressed,
  runWithAutoInstrumentationSuppressed,
} from "../auto-instrumentation-suppression";
import { runInstrumentation } from "../core/observe-result";
import { observeStream } from "../core/stream-patcher";
import { extractTokenMetrics } from "./ai-sdk-metrics";
import { aiSDKBatchInput, aiSDKBatchOutput } from "./ai-sdk-batch-span-data";
import {
  deterministicDigest,
  digestHex,
  digestUuid,
} from "./openai-manual-instrumentation-utils";

type BatchContext = {
  version: 1;
  batch: AISDKBatchReference;
  parent: string;
  startTime: number;
  terminalTime?: number;
  status: AISDKBatchStatus["status"];
  requests: Array<{ id: string; model: string }>;
  denyOutputPaths: string[];
};

type BatchRequestIdentity = { rowId: string; spanId: string; model: string };

type BatchTrace = {
  context: BatchContext;
  rowId: string;
  spanId: string;
  rootSpanId: string;
  taskParent: string;
  children: Map<string, BatchRequestIdentity>;
  completed: Set<string>;
};

// SDK copies share correlation state, but no live spans or provider payloads.
const stateKey = Symbol.for("braintrust.ai-sdk.batch-traces.v1");
const shared = globalThis as typeof globalThis & {
  [stateKey]?: Map<string, BatchTrace>;
};
const traces = (shared[stateKey] ??= new Map<string, BatchTrace>());

function batchSpan(trace: BatchTrace): Span {
  const parent = SpanComponentsV4.fromStr(trace.context.parent);
  return withCurrent(NOOP_SPAN, () =>
    _internalStartSpanWithInitialMergeAndParentSpanIds(
      withSpanInstrumentationName(
        {
          name: "ai.batch",
          type: SpanTypeAttribute.TASK,
          parent: trace.context.parent,
          ...(!parent.data.span_id
            ? {
                parentSpanIds: {
                  parentSpanIds: [],
                  rootSpanId: trace.rootSpanId,
                },
              }
            : {}),
          spanId: trace.spanId,
          startTime: trace.context.startTime,
          event: {
            id: trace.rowId,
            metadata: {
              batch_id: trace.context.batch.id,
              provider: trace.context.batch.provider,
              status: trace.context.status,
            },
          },
        },
        INSTRUMENTATION_NAMES.AI_SDK,
      ),
    ),
  );
}

function requestSpan(
  trace: BatchTrace,
  id: string,
  identity: BatchRequestIdentity,
): Span {
  return withCurrent(NOOP_SPAN, () =>
    _internalStartSpanWithInitialMerge(
      withSpanInstrumentationName(
        {
          name: "ai.batch.request",
          type: SpanTypeAttribute.LLM,
          parent: trace.taskParent,
          spanId: identity.spanId,
          startTime: trace.context.startTime,
          event: {
            id: identity.rowId,
            metadata: {
              batch_id: trace.context.batch.id,
              request_id: id,
              model: identity.model,
              provider: trace.context.batch.provider,
            },
          },
        },
        INSTRUMENTATION_NAMES.AI_SDK,
      ),
    ),
  );
}

async function createTrace(context: BatchContext): Promise<BatchTrace> {
  const key = JSON.stringify([context.batch.provider, context.batch.id]);
  const existing = traces.get(key);
  if (existing) return existing;
  const [row, span, root] = await Promise.all([
    deterministicDigest("ai:batch:row", key),
    deterministicDigest("ai:batch:span", key),
    deterministicDigest("ai:batch:root", key),
  ]);
  const trace: BatchTrace = {
    context,
    rowId: digestUuid(row),
    spanId: digestHex(span, 8),
    rootSpanId: digestHex(root, 16),
    taskParent: "",
    children: new Map(),
    completed: new Set(),
  };
  // Bound hashing/span construction regardless of the number of requests.
  for (const { id, model } of context.requests) {
    const digest = await deterministicDigest("ai:batch:request", key, id);
    trace.children.set(id, {
      rowId: digestUuid(digest),
      spanId: digestHex(digest, 8),
      model,
    });
  }
  const concurrent = traces.get(key);
  if (concurrent) return concurrent;
  trace.taskParent = await batchSpan(trace).export();
  traces.set(key, trace);
  return trace;
}

export async function traceAISDKStartBatch(
  call: () => ReturnType<AISDKBatchAPI["experimental_startBatch"]>,
  params: AISDKStartBatchOptions,
  denyOutputPaths: string[],
): ReturnType<AISDKBatchAPI["experimental_startBatch"]> {
  if (isAutoInstrumentationSuppressed()) return call();
  const parent = getSpanParentObject();
  const startTime = getCurrentUnixTimestamp();
  let result: Awaited<ReturnType<AISDKBatchAPI["experimental_startBatch"]>>;
  try {
    result = await runWithAutoInstrumentationSuppressed(call);
  } catch (error) {
    runInstrumentation(() => {
      const span = startSpan(
        withSpanInstrumentationName(
          {
            name: "ai.batch",
            type: SpanTypeAttribute.TASK,
            startTime,
          },
          INSTRUMENTATION_NAMES.AI_SDK,
        ),
      );
      span.log({
        error: error instanceof Error ? error : new Error(String(error)),
      });
      span.end();
    });
    throw error;
  }
  await runInstrumentation(async () => {
    // Gateway currently supports only text batches. Leave other modalities alone.
    if (params.requests.some((request) => request.type !== "text")) return;
    const trace = await createTrace({
      version: 1,
      batch: { version: 2, id: result.id, provider: result.provider },
      parent: "toStr" in parent ? parent.toStr() : await parent.export(),
      startTime:
        result.createdAt && Number.isFinite(Date.parse(result.createdAt))
          ? Date.parse(result.createdAt) / 1000
          : startTime,
      status: result.status,
      requests: params.requests.map(({ id, model }) => ({ id, model })),
      denyOutputPaths,
    });
    for (const request of params.requests) {
      const data = await aiSDKBatchInput(request);
      requestSpan(trace, request.id, trace.children.get(request.id)!).log(data);
    }
    updateStatus(trace, result);
  })?.catch(() => {});
  return result;
}

function updateStatus(trace: BatchTrace, status: AISDKBatchStatus): void {
  trace.context.status = status.status;
  if (status.status !== "pending") {
    trace.context.terminalTime ??= getCurrentUnixTimestamp();
  }
  batchSpan(trace).log({
    metadata: {
      status: status.status,
      raw_status: status.rawStatus,
      ...(status.requestCounts
        ? {
            request_counts: {
              total: status.requestCounts.total,
              pending: status.requestCounts.pending,
              completed: status.requestCounts.completed,
              failed: status.requestCounts.failed,
            },
          }
        : {}),
    },
    ...(status.error ? { error: new Error(status.error.message) } : {}),
  });
}

export async function traceAISDKBatchStatus(
  call: () => ReturnType<AISDKBatchAPI["experimental_getBatchStatus"]>,
  batch: AISDKBatchReference,
): ReturnType<AISDKBatchAPI["experimental_getBatchStatus"]> {
  if (isAutoInstrumentationSuppressed()) return call();
  const result = await runWithAutoInstrumentationSuppressed(call);
  runInstrumentation(() => {
    const trace = traces.get(JSON.stringify([batch.provider, batch.id]));
    if (trace) updateStatus(trace, result);
  });
  return result;
}

export async function traceAISDKCancelBatch(
  call: () => ReturnType<AISDKBatchAPI["experimental_cancelBatch"]>,
  batch: AISDKBatchReference,
): ReturnType<AISDKBatchAPI["experimental_cancelBatch"]> {
  if (isAutoInstrumentationSuppressed()) return call();
  const result = await runWithAutoInstrumentationSuppressed(call);
  runInstrumentation(() => {
    const trace = traces.get(JSON.stringify([batch.provider, batch.id]));
    if (trace)
      batchSpan(trace).log({ metadata: { cancellation_requested: true } });
  });
  return result;
}

export function traceAISDKBatchResults(
  call: () => ReturnType<AISDKBatchAPI["experimental_getBatchResults"]>,
  batch: AISDKBatchReference,
  denyOutputPaths?: string[],
): ReturnType<AISDKBatchAPI["experimental_getBatchResults"]> {
  if (isAutoInstrumentationSuppressed()) return call();
  const result = runWithAutoInstrumentationSuppressed(call);
  runInstrumentation(() => {
    const key = JSON.stringify([batch.provider, batch.id]);
    const trace = traces.get(key);
    if (!trace) return;
    let invalid = false;
    const seen = new Set<string>();
    observeStream<AISDKBatchItem>(result, {
      debugLabel: "AI SDK batch results",
      onChunk(item) {
        const identity = trace.children.get(item.id);
        if (!identity || item.type !== "text" || seen.has(item.id)) {
          invalid = true;
          debugLogger.debug(
            "AI SDK batch result has an unknown or duplicate request ID",
          );
          return;
        }
        seen.add(item.id);
        if (trace.completed.has(item.id)) return;
        const child = requestSpan(trace, item.id, identity);
        if (item.status === "succeeded") {
          child.log({
            output: aiSDKBatchOutput(
              item,
              denyOutputPaths ?? trace.context.denyOutputPaths,
            ),
            metrics: extractTokenMetrics({
              usage: item.usage,
              providerMetadata: item.providerMetadata,
            }),
            metadata: {
              status: item.status,
              ...(typeof item.response?.modelId === "string"
                ? { model: item.response.modelId }
                : {}),
            },
          });
        } else if (["failed", "cancelled", "expired"].includes(item.status)) {
          child.log({
            error: new Error(
              item.error?.message ?? `AI SDK batch request ${item.status}`,
            ),
            metadata: { status: item.status },
          });
        } else {
          invalid = true;
          return;
        }
        child.end({
          endTime: Math.max(
            trace.context.startTime,
            trace.context.terminalTime ?? getCurrentUnixTimestamp(),
          ),
        });
        trace.completed.add(item.id);
      },
      onComplete() {
        if (invalid) return;
        const endTime = Math.max(
          trace.context.startTime,
          trace.context.terminalTime ?? getCurrentUnixTimestamp(),
        );
        if (trace.context.status === "failed") {
          batchSpan(trace).log({ error: new Error("AI SDK batch failed") });
          for (const [id, identity] of trace.children) {
            if (trace.completed.has(id)) continue;
            const child = requestSpan(trace, id, identity);
            child.log({
              error: new Error(
                "AI SDK batch failed before returning this request",
              ),
            });
            child.end({ endTime });
            trace.completed.add(id);
          }
        }
        if (trace.completed.size !== trace.children.size) return;
        if (trace.context.status === "pending")
          trace.context.status = "completed";
        batchSpan(trace).end({ endTime });
        traces.delete(key);
      },
      onCancel(error) {
        if (error !== undefined)
          batchSpan(trace).log({
            error: error instanceof Error ? error : new Error(String(error)),
          });
      },
    });
  });
  return result;
}

export async function exportAISDKBatchContext(
  batch: AISDKBatchReference,
): Promise<string | undefined> {
  return runInstrumentation(() => {
    const context = traces.get(
      JSON.stringify([batch.provider, batch.id]),
    )?.context;
    return context ? JSON.stringify(context) : undefined;
  });
}

export async function resumeAISDKBatchContext(
  serialized: string,
): Promise<void> {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isObject(value) ||
      value.version !== 1 ||
      !isObject(value.batch) ||
      value.batch.version !== 2 ||
      typeof value.batch.id !== "string" ||
      typeof value.batch.provider !== "string" ||
      typeof value.parent !== "string" ||
      typeof value.startTime !== "number" ||
      !Number.isFinite(value.startTime) ||
      (value.terminalTime !== undefined &&
        (typeof value.terminalTime !== "number" ||
          !Number.isFinite(value.terminalTime))) ||
      !["pending", "completed", "failed"].includes(String(value.status)) ||
      !Array.isArray(value.requests) ||
      value.requests.length === 0 ||
      !value.requests.every(
        (request) =>
          isObject(request) &&
          typeof request.id === "string" &&
          typeof request.model === "string",
      ) ||
      !Array.isArray(value.denyOutputPaths) ||
      !value.denyOutputPaths.every((path) => typeof path === "string")
    )
      throw new Error("Invalid AI SDK batch trace context");
    const requests = value.requests.map(
      (request: { id: string; model: string }) => ({
        id: request.id,
        model: request.model,
      }),
    );
    if (new Set(requests.map(({ id }) => id)).size !== requests.length)
      throw new Error("Duplicate batch request IDs");
    SpanComponentsV4.fromStr(value.parent);
    await createTrace({
      version: 1,
      batch: { version: 2, id: value.batch.id, provider: value.batch.provider },
      parent: value.parent,
      startTime: value.startTime,
      terminalTime: value.terminalTime as number | undefined,
      status: value.status as AISDKBatchStatus["status"],
      requests,
      denyOutputPaths: value.denyOutputPaths,
    });
  } catch {
    // Do not print untrusted serialized data, which may contain secrets.
    debugLogger.debug("Could not resume AI SDK batch trace context");
  }
}
