TRANSACTION_ID_FIELD = "_xact_id"
OBJECT_DELETE_FIELD = "_object_delete"
CREATED_FIELD = "created"
ID_FIELD = "id"

IS_MERGE_FIELD = "_is_merge"
MERGE_PATHS_FIELD = "_merge_paths"
ARRAY_DELETE_FIELD = "_array_delete"

AUDIT_SOURCE_FIELD = "_audit_source"
AUDIT_METADATA_FIELD = "_audit_metadata"
VALID_SOURCES = ["app", "api", "external"]

PARENT_ID_FIELD = "_parent_id"

ASYNC_SCORING_CONTROL_FIELD = "_async_scoring_control"
SKIP_ASYNC_SCORING_FIELD = "_skip_async_scoring"

# Keys that identify which object (experiment, dataset, project logs, etc.) a row belongs to.
OBJECT_ID_KEYS = (
    "experiment_id",
    "dataset_id",
    "prompt_session_id",
    "project_id",
    "log_id",
    "function_data",
)
