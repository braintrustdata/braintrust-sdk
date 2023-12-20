from typing import Dict, List

from .db_fields import IS_MERGE_FIELD
from .util import merge_dicts


def _generate_merged_row_key(row):
    return tuple(
        row.get(k)
        for k in ["org_id", "project_id", "experiment_id", "dataset_id", "prompt_session_id", "log_id", "id"]
    )


def merge_row_batch(rows: List[Dict]) -> List[Dict]:
    """Given a batch of rows, merges conflicting rows together to end up with a
    set of rows to insert. Returns a list of de-conflicted rows. Note that the
    returned rows will be the same objects as the input `rows`, meaning they are
    mutated in place.

    There are a few important considerations for the merge procedure:

    - Ensuring we only log one version of each row to the DB:

    Imagine we have several rows in the batch with the same ID:

        [{"make_object_id(..)": "xyz", "id": 1, "value": 1},
         {"make_object_id(...)": "xyz", "id": 1, "value": 2}]

    If we log both rows and assign them both the same transaction ID, future
    queries will not be able to disamgiguate ordering here (i.e that `value: 2`
    is the "later" value). So we must consolidate these rows into one before
    logging.

    - Merging rows with IS_MERGE_FIELD == True:

    Rows can either be incrementally updated or replaced entirely. For a
    particular row, we use the IS_MERGE_FIELD to determine whether we merge or
    replace. In case there are several incremental updates to the same row
    within the batch, we merge them into one incremental update here, so that we
    only need to do one merge in the DB.

    We need to be careful to preserve the correct value of IS_MERGE_FIELD with
    respect to the DB. For instance, if we have one batch of rows:

        [{"make_object_id(...)": "xyz", "id": 1, "value": {"a": 12}},
         {"make_object_id(...)": "xyz", "id": 1, "value": {"b": 13},
          IS_MERGE_FIELD: True}]

    We need to make sure the row inserted into the DB has IS_MERGE_FIELD == False,
    otherwise we might merge it with a previous existing version of the row.
    """

    # First add any rows with no ID to `out`, since they will always be
    # independent.
    out = []
    remaining_rows = []
    for row in rows:
        if row.get("id") is None:
            out.append(row)
        else:
            remaining_rows.append(row)

    row_groups = {}
    for row in remaining_rows:
        key = _generate_merged_row_key(row)
        existing_row = row_groups.get(key)
        # If there is an existing row and the new row has the IS_MERGE_FIELD ==
        # True property, we merge it with the existing row. Otherwise we can
        # replace it.
        if existing_row is not None and row.get(IS_MERGE_FIELD):
            # Preserve IS_MERGE_FIELD == False if the existing_row had it set to
            # false.
            preserve_nomerge = not existing_row.get(IS_MERGE_FIELD)
            merge_dicts(existing_row, row)
            if preserve_nomerge:
                del existing_row[IS_MERGE_FIELD]
        else:
            row_groups[key] = row

    out.extend(row_groups.values())
    return out
