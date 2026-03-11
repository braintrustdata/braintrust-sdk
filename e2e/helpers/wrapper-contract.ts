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

  return payloads
    .flatMap((payload) => payload.rows)
    .filter((row) => row.root_span_id === rootSpanId);
}
