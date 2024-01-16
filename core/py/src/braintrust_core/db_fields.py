TRANSACTION_ID_FIELD = "_xact_id"
OBJECT_DELETE_FIELD = "_object_delete"
CREATED_FIELD = "created"
IS_MERGE_FIELD = "_is_merge"
ID_FIELD = "id"

MERGE_TYPE_FIELD = "_merge_type"
MERGE_TYPES = ["shallow", "deep"]

AUDIT_SOURCE_FIELD = "_audit_source"
AUDIT_METADATA_FIELD = "_audit_metadata"
VALID_SOURCES = ["app", "api", "external"]

PARENT_ID_FIELD = "_parent_id"

ALL_ROW_ID_FIELDS = [
    ID_FIELD,
    TRANSACTION_ID_FIELD,
    CREATED_FIELD,
    IS_MERGE_FIELD,
    MERGE_TYPE_FIELD,
    OBJECT_DELETE_FIELD,
]
