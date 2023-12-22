// Format and utils for serializing objects to create spans later. Keep this in
// sync with the span serialization implementation in the python SDK.

export type SpanObjectIds =
  | { object_kind: "e"; project_id: string; experiment_id: string }
  | { object_kind: "pl"; org_id: string; project_id: string; log_id: "g" };

export type SpanParentSpanIds =
  | { parent_span_kind: "sub_span"; span_id: string; root_span_id: string }
  | { parent_span_kind: "root_span"; span_id: string; root_span_id?: undefined }
  | { parent_span_kind: "none"; span_id?: undefined; root_span_id?: undefined };

export type SerializedSpanInfo = SpanObjectIds & SpanParentSpanIds;

export function serializedSpanInfoToString(info: SerializedSpanInfo): string {
  const objectIds = (() => {
    if (info.object_kind === "e") {
      return [info.project_id, info.experiment_id];
    } else if (info.object_kind === "pl") {
      return [info.org_id, info.project_id];
    } else {
      throw new Error(`Unknown kind ${(info as any).object_kind}`);
    }
  })();
  const spanParentIds = (() => {
    if (info.parent_span_kind === "sub_span") {
      return [info.span_id, info.root_span_id];
    } else if (info.parent_span_kind === "root_span") {
      return [info.span_id, ""];
    } else if (info.parent_span_kind === "none") {
      return ["", ""];
    } else {
      throw new Error(
        `Unknown parent_span_kind ${(info as any).parent_span_kind}`
      );
    }
  })();
  const ids = [info.object_kind, ...objectIds, ...spanParentIds];
  // Since all of these IDs are auto-generated as UUIDs, we can expect them to
  // not contain any colons.
  for (const id of ids) {
    if (id.includes(":")) {
      throw new Error(`Unexpected: id ${id} should not have a ':'`);
    }
  }
  return ids.join(":");
}

export function serializedSpanInfoFromString(s: string): SerializedSpanInfo {
  const ids = s.split(":");
  if (ids.length !== 5) {
    throw new Error(
      `Expected serialized info ${s} to have 5 colon-separated components`
    );
  }

  const objectIds = (() => {
    if (ids[0] === "e") {
      return {
        object_kind: ids[0],
        project_id: ids[1],
        experiment_id: ids[2],
      } as const;
    } else if (ids[0] === "pl") {
      return {
        object_kind: ids[0],
        org_id: ids[1],
        project_id: ids[2],
        log_id: "g",
      } as const;
    } else {
      throw new Error(`Unknown serialized object_kind ${ids[0]}`);
    }
  })();

  const spanParentIds = (() => {
    if (ids[4] === "") {
      if (ids[3] === "") {
        return { parent_span_kind: "none" } as const;
      } else {
        return { parent_span_kind: "root_span", span_id: ids[3] } as const;
      }
    } else {
      return {
        parent_span_kind: "sub_span",
        span_id: ids[3],
        root_span_id: ids[4],
      } as const;
    }
  })();
  return {
    ...objectIds,
    ...spanParentIds,
  };
}
