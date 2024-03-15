from typing import Dict, List, Optional

from .db_fields import IS_MERGE_FIELD, PARENT_ID_FIELD
from .graph_util import UndirectedGraph, topological_sort, undirected_connected_components
from .util import merge_dicts


def _generate_merged_row_key(row, use_parent_id_for_id=False):
    return tuple(
        row.get(k)
        for k in [
            "org_id",
            "project_id",
            "experiment_id",
            "dataset_id",
            "prompt_session_id",
            "log_id",
            PARENT_ID_FIELD if use_parent_id_for_id else "id",
        ]
    )


def merge_row_batch(rows: List[Dict]) -> List[List[Dict]]:
    """Given a batch of rows, merges conflicting rows together to end up with a
    set of rows to insert. Returns a set of de-conflicted rows, as a list of
    lists, where separate lists contain "independent" rows which can be
    processed concurrently, while the rows in each list must be processed in
    order, as later rows may depend on earlier ones.

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
                "Logged row is missing an id. This is an internal braintrust error. Please contact us at info@braintrustdata.com for help"
            )

    row_groups = {}
    for row in rows:
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

    merged = list(row_groups.values())

    # Now that we have just one row per id, we can bucket and order the rows by
    # their PARENT_ID_FIELD relationships.
    row_to_label = {_generate_merged_row_key(r): i for i, r in enumerate(merged)}

    # Form a graph where edges go from parents to their children.
    graph = {i: set() for i in range(len(merged))}
    for i, r in enumerate(merged):
        parent_id = r.get(PARENT_ID_FIELD)
        if not parent_id:
            continue
        parent_row_key = _generate_merged_row_key(r, use_parent_id_for_id=True)
        parent_label = row_to_label.get(parent_row_key)
        if parent_label is not None:
            graph[parent_label].add(i)

    # Group together all the connected components of the undirected graph to get
    # all groups of rows which each row in a group has a PARENT_ID_FIELD
    # relationship with at least one other row in the group.
    connected_components = undirected_connected_components(
        UndirectedGraph(vertices=set(graph.keys()), edges=set((k, v) for k, vs in graph.items() for v in vs))
    )

    # For each connected row group, run topological sort over that subgraph to
    # get an ordering of rows where parents come before children.
    buckets = [topological_sort(graph, visitation_order=cc) for cc in connected_components]
    return [[merged[i] for i in bucket] for bucket in buckets]


def batch_items(
    items: List[List[str]], batch_max_num_items: Optional[int] = None, batch_max_num_bytes: Optional[int] = None
) -> List[List[List[str]]]:
    """Repartition the given list of items into sets of batches which can be
    published in parallel or in sequence.

    Output-wise, each outer List[List[str]] is a set of batches which must be
    published in sequence. Within each set of batches, each individual List[str]
    batch may be published in parallel with all other batches in its set,
    retaining the order within the batch. So from outside to inside, it goes
    ordered -> parallel -> ordered.

    Arguments:

    - `items` is a list of ordered buckets, where the constraint is that items
      in different buckets can be published in parallel, while items within a
      bucket must be published in sequence. That means that if two items are in
      the same bucket, they will either appear in the same innermost List[str]
      in the output, or in separate List[List[str]] batch sets, with their
      relative order preserved. If two items are in different buckets, they can
      appear in different List[str] batches.

    - `batch_max_num_items` is the maximum number of items in each List[str]
      batch. If not provided, there is no limit on the number of items.

    - `batch_max_num_bytes` is the maximum number of bytes (computed as
      `sum(len(item) for item in batch)`) in each List[str] batch. If an
      individual item exceeds `batch_max_num_bytes` in size, we will place it in
      its own batch. If not provided, there is no limit on the number of bytes.
    """

    if batch_max_num_items is None:
        batch_max_num_items = float("inf")
    if batch_max_num_bytes is None:
        batch_max_num_bytes = float("inf")

    assert batch_max_num_items > 0

    output = []
    next_items = []
    batch_set = []
    batch = []
    batch_len = 0

    def add_to_batch(item):
        nonlocal batch_len
        batch.append(item)
        batch_len += len(item)

    def flush_batch():
        nonlocal batch, batch_len
        batch_set.append(batch)
        batch = []
        batch_len = 0

    while items:
        for bucket in items:
            i = 0
            for item in bucket:
                if len(batch) == 0 or (
                    len(item) + batch_len < batch_max_num_bytes and len(batch) < batch_max_num_items
                ):
                    add_to_batch(item)
                elif i == 0:
                    # If the very first item in the bucket fills the batch, we
                    # can flush this batch and start a new one which includes
                    # this item.
                    flush_batch()
                    add_to_batch(item)
                else:
                    break
                i += 1
            # If we didn't completely exhaust the bucket, save it for the next
            # batch set.
            if i < len(bucket):
                next_items.append(bucket[i:])
            # If we have filled the batch, flush it.
            if batch_len >= batch_max_num_bytes or len(batch) >= batch_max_num_items:
                flush_batch()

        # We've finished an iteration through all the buckets. Anything
        # remaining in `next_items` will need to be processed in a subsequent
        # batch set, so flush our remaining batch and the batch set, and use
        # next_items for the next iteration.
        if batch:
            flush_batch()
        if batch_set:
            output.append(batch_set)
            batch_set = []
        items, next_items = next_items, []

    return output
