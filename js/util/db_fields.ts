export const TRANSACTION_ID_FIELD = "_xact_id";
export const OBJECT_DELETE_FIELD = "_object_delete";
export const CREATED_FIELD = "created";
export const ID_FIELD = "id";

export const IS_MERGE_FIELD = "_is_merge";
export const MERGE_PATHS_FIELD = "_merge_paths";
export const ARRAY_DELETE_FIELD = "_array_delete";

export const AUDIT_SOURCE_FIELD = "_audit_source";
export const AUDIT_METADATA_FIELD = "_audit_metadata";
export const VALID_SOURCES = ["app", "api", "external"] as const;
export type Source = (typeof VALID_SOURCES)[number];

export const PARENT_ID_FIELD = "_parent_id";

export const ASYNC_SCORING_CONTROL_FIELD = "_async_scoring_control";
export const SKIP_ASYNC_SCORING_FIELD = "_skip_async_scoring";

// While transaction ids are convertible to 64-bit integers (BigInts in JS), we
// prefer to treat them as strings so they uniformly serialize/deserialize as
// JSON.
export type TransactionId = string;
