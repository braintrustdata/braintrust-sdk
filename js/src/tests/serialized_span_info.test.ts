import {
  SerializedSpanInfo,
  serializedSpanInfoToString,
  serializedSpanInfoFromString,
} from "../serialized_span_info";

test("serializedSpanInfoToFromString", () => {
  const items: SerializedSpanInfo[] = [
    {
      object_kind: "e",
      project_id: "abc",
      experiment_id: "q",
      parent_span_kind: "sub_span",
      span_id: "xyz",
      root_span_id: "xxx",
    },
    {
      object_kind: "pl",
      org_id: "abc",
      project_id: "def",
      log_id: "g",
      parent_span_kind: "sub_span",
      span_id: "xyz",
      root_span_id: "xxx",
    },
    {
      object_kind: "e",
      project_id: "abc",
      experiment_id: "q",
      parent_span_kind: "root_span",
      span_id: "zzz",
    },
    {
      object_kind: "e",
      project_id: "abc",
      experiment_id: "q",
      parent_span_kind: "none",
    },
  ];

  for (const item of items) {
    expect(
      serializedSpanInfoFromString(serializedSpanInfoToString(item))
    ).toMatchObject(item);
  }
});
