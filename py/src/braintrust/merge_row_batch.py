# Mirrors the implementation of merge_row_batch in api/chalicelib/util.py.
#
# TODO(manu): Share common functionality between SDK and chalicelib.

from .util import IS_MERGE_FIELD, merge_dicts


def _generate_unique_row_key(row: dict):
    def coalesce_empty(field):
        return row.get(field, "")

    return (
        coalesce_empty("experiment_id")
        + ":"
        + coalesce_empty("dataset_id")
        + ":"
        + coalesce_empty("prompt_session_id")
        + ":"
        + coalesce_empty("id")
    )


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
