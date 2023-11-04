from .util import IS_MERGE_FIELD, merge_dicts

DATA_OBJECT_KEYS = [
    "org_id",
    "project_id",
    "experiment_id",
    "dataset_id",
    "prompt_session_id",
    "log_id",
]


def _generate_unique_row_key(row: dict):
    def coalesce_empty(field):
        return row.get(field, "")

    return ":".join([coalesce_empty(k) for k in DATA_OBJECT_KEYS + ["id"]])


def merge_row_batch(rows: list[dict]) -> list[dict]:
    out = []
    remaining_rows = []
    # First add any rows with no ID to `out`, since they will always be
    # independent.
    for row in rows:
        if row.get("id") is None:
            out.append(row)
        else:
            remaining_rows.append(row)
    row_groups = {}
    for row in remaining_rows:
        key = _generate_unique_row_key(row)
        existing_row = row_groups.get(key)
        if existing_row is not None and row.get(IS_MERGE_FIELD):
            preserve_nomerge = not existing_row.get(IS_MERGE_FIELD)
            merge_dicts(existing_row, row)
            if preserve_nomerge:
                del existing_row[IS_MERGE_FIELD]
        else:
            row_groups[key] = row
    out.extend(row_groups.values())
    return out
