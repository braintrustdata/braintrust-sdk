export const TRANSACTION_ID_FIELD = "_xact_id";
export const OBJECT_DELETE_FIELD = "_object_delete";
export const CREATED_FIELD = "created";
export const IS_MERGE_FIELD = "_is_merge";
export const ID_FIELD = "id";

export const MERGE_TYPE_FIELD = "_merge_type";
export const MERGE_TYPES = ["shallow", "deep"];
export type MergeType = (typeof MERGE_TYPES)[number];

export const AUDIT_SOURCE_FIELD = "_audit_source";
export const AUDIT_METADATA_FIELD = "_audit_metadata";
export const VALID_SOURCES = ["app", "api", "external"] as const;
export type Source = (typeof VALID_SOURCES)[number];

export const PARENT_ID_FIELD = "_parent_id";

export const ALL_ROW_ID_FIELDS = [
  TRANSACTION_ID_FIELD,
  OBJECT_DELETE_FIELD,
  CREATED_FIELD,
  IS_MERGE_FIELD,
  MERGE_TYPE_FIELD,
  ID_FIELD,
];
