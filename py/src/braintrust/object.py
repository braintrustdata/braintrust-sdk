from typing import Any, Mapping

from braintrust_core import DatasetEvent

from .db_fields import MERGE_PATHS_FIELD

DEFAULT_IS_LEGACY_DATASET = False


def ensure_dataset_record(r: DatasetEvent, legacy: bool) -> DatasetEvent:
    if legacy:
        return ensure_legacy_dataset_record(r)
    else:
        return ensure_new_dataset_record(r)


def ensure_legacy_dataset_record(r: DatasetEvent):
    if "output" in r or "expected" not in r:
        return r
    row: DatasetEvent = {**r}
    row["output"] = row["expected"]  # type: ignore
    return row


def ensure_new_dataset_record(r: DatasetEvent):
    if "expected" in r or "output" not in r:
        return r
    row: DatasetEvent = {**r}
    row["expected"] = row["output"]
    return row


def make_legacy_event(e: Mapping[str, Any]) -> Mapping[str, Any]:
    if "dataset_id" not in e or "expected" not in e:
        return e

    event = {**e}
    event["output"] = event.pop("expected")

    if MERGE_PATHS_FIELD in event:
        for path in event[MERGE_PATHS_FIELD] or []:
            if len(path) > 0 and path[0] == "expected":
                path[0] = "output"

    return event
