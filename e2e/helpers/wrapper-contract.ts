import type {
  CapturedLogEvent,
  CapturedLogPayload,
  CapturedLogRow,
} from "./mock-braintrust-server";
import type { Json } from "./normalize";

function pickMetadata(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): Json {
  if (!metadata) {
    return null;
  }

  const picked = Object.fromEntries(
    keys.flatMap((key) =>
      key in metadata ? [[key, metadata[key] as Json]] : [],
    ),
  );

  return Object.keys(picked).length > 0 ? (picked as Json) : null;
}

function stageRank(row: CapturedLogRow): number {
  const metrics =
    typeof row.metrics === "object" &&
    row.metrics !== null &&
    !Array.isArray(row.metrics)
      ? (row.metrics as Record<string, unknown>)
      : undefined;
  const metricKeys = Object.keys(metrics ?? {});
  const hasOutput = row.output !== undefined;
  const hasNonEndMetrics = metricKeys.some((key) => key !== "end");

  if (row._is_merge !== true) {
    return 0;
  }
  if (hasNonEndMetrics && !hasOutput) {
    return 1;
  }
  if (hasOutput) {
    return 2;
  }
  return 3;
}

export function summarizeWrapperContract(
  event: CapturedLogEvent,
  metadataKeys: string[] = [],
): Json {
  return {
    has_input: event.input !== undefined && event.input !== null,
    has_output: event.output !== undefined && event.output !== null,
    metadata: pickMetadata(
      event.row.metadata as Record<string, unknown>,
      metadataKeys,
    ),
    metric_keys: Object.keys(event.metrics ?? {})
      .filter((key) => key !== "start" && key !== "end")
      .sort(),
    name: event.span.name ?? null,
    root_span_id: event.span.rootId ?? null,
    span_id: event.span.id ?? null,
    span_parents: event.span.parentIds,
    type: event.span.type ?? null,
  } satisfies Json;
}

export function payloadRowsForRootSpan(
  payloads: CapturedLogPayload[],
  rootSpanId: string | undefined,
): CapturedLogRow[] {
  if (!rootSpanId) {
    return [];
  }

  const rows = payloads
    .flatMap((payload) => payload.rows)
    .filter((row) => row.root_span_id === rootSpanId);

  const spanOrder = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.span_id === "string" && !spanOrder.has(row.span_id)) {
      spanOrder.set(row.span_id, spanOrder.size);
    }
  }

  return [...rows].sort((left, right) => {
    const leftOrder =
      typeof left.span_id === "string"
        ? (spanOrder.get(left.span_id) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
    const rightOrder =
      typeof right.span_id === "string"
        ? (spanOrder.get(right.span_id) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return stageRank(left) - stageRank(right);
  });
}
