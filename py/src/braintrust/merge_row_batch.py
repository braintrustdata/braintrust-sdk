from collections.abc import Callable, Sequence
from typing import Any, Optional, TypeVar

from .db_fields import IS_MERGE_FIELD

T = TypeVar("T")
from .util import merge_dicts

_MergedRowKey = tuple[Optional[Any], ...]


def _generate_merged_row_key(row: dict[str, Any]) -> _MergedRowKey:
    return tuple(
        row.get(k)
        for k in [
            "org_id",
            "project_id",
            "experiment_id",
            "dataset_id",
            "prompt_session_id",
            "log_id",
            "id",
        ]
    )


# These fields will be retained as-is when merging rows.
MERGE_ROW_SKIP_FIELDS = [
    "created",
    "span_id",
    "root_span_id",
    "span_parents",
    "_parent_id",
    # TODO: handle merge paths.
]


def _pop_merge_row_skip_fields(row: dict[str, Any]) -> dict[str, Any]:
    popped = {}
    for field in MERGE_ROW_SKIP_FIELDS:
        if field in row:
            popped[field] = row.pop(field)
    return popped


def _restore_merge_row_skip_fields(row: dict[str, Any], skip_fields: dict[str, Any]):
    for field in MERGE_ROW_SKIP_FIELDS:
        row.pop(field, None)
        if field in skip_fields:
            row[field] = skip_fields[field]


def merge_row_batch(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Given a batch of rows, merges conflicting rows together to end up with a
    set of rows to insert. Returns a set of de-conflicted rows as a flat list.

    Note that the returned rows will be the same objects as the input `rows`,
    meaning they are mutated in place.

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

    # Check that no row is missing an ID.
    for row in rows:
        if row.get("id") is None:
            raise Exception(
                "Logged row is missing an id. This is an internal braintrust error. Please contact us at info@braintrust.dev for help"
            )

    row_groups: dict[_MergedRowKey, dict[str, Any]] = {}
    for row in rows:
        key = _generate_merged_row_key(row)
        existing_row = row_groups.get(key)
        # If there is an existing row and the new row has the IS_MERGE_FIELD ==
        # True property, we merge it with the existing row. Otherwise we can
        # replace it.
        if existing_row is not None and row.get(IS_MERGE_FIELD):
            skip_fields = _pop_merge_row_skip_fields(existing_row)
            # Preserve IS_MERGE_FIELD == False if the existing_row had it set to
            # false.
            preserve_nomerge = not existing_row.get(IS_MERGE_FIELD)
            merge_dicts(existing_row, row)
            _restore_merge_row_skip_fields(existing_row, skip_fields)
            if preserve_nomerge:
                del existing_row[IS_MERGE_FIELD]
        else:
            row_groups[key] = row

    return list(row_groups.values())


def batch_items(
    items: list[T],
    batch_max_num_items: int | None = None,
    batch_max_num_bytes: int | None = None,
    get_byte_size: Callable[[T], int] | None = None,
) -> list[list[T]]:
    """Repartition the given list of items into batches.

    Arguments:

    - `items` is a list of items to batch.

    - `batch_max_num_items` is the maximum number of items in each batch.
      If not provided, there is no limit on the number of items.

    - `batch_max_num_bytes` is the maximum number of bytes in each batch.
      If an individual item exceeds `batch_max_num_bytes` in size, we
      will place it in its own batch. If not provided, there is no limit on
      the number of bytes.

    - `get_byte_size` is a function that returns the byte size of an item.
      If not provided, defaults to `len(item)` (works for strings).
    """

    if batch_max_num_items is not None and batch_max_num_items <= 0:
        raise ValueError(f"batch_max_num_items must be positive; got {batch_max_num_items}")
    if batch_max_num_bytes is not None and batch_max_num_bytes < 0:
        raise ValueError(f"batch_max_num_bytes must be nonnegative; got {batch_max_num_bytes}")

    if get_byte_size is None:

        def get_byte_size(item: T) -> int:
            return len(item)  # type: ignore[arg-type]

    output: list[list[T]] = []
    batch: list[T] = []
    batch_len = 0

    def add_to_batch(item: T) -> None:
        nonlocal batch_len
        batch.append(item)
        batch_len += get_byte_size(item)

    def flush_batch() -> None:
        nonlocal batch, batch_len
        output.append(batch)
        batch = []
        batch_len = 0

    for item in items:
        item_size = get_byte_size(item)
        if len(batch) > 0 and not (
            (batch_max_num_bytes is None or item_size + batch_len < batch_max_num_bytes)
            and (batch_max_num_items is None or len(batch) < batch_max_num_items)
        ):
            flush_batch()
        add_to_batch(item)

    if len(batch) > 0:
        flush_batch()

    return output
