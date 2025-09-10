from .generated_types import DatasetEvent

DEFAULT_IS_LEGACY_DATASET = False


def ensure_dataset_record(r: DatasetEvent, legacy: bool) -> DatasetEvent:
    if legacy:
        return ensure_legacy_dataset_record(r)
    else:
        return ensure_new_dataset_record(r)


def ensure_legacy_dataset_record(r: DatasetEvent) -> DatasetEvent:
    if "output" in r:
        return r
    row = r.copy()
    row["output"] = row.pop("expected")
    return row


def ensure_new_dataset_record(r: DatasetEvent) -> DatasetEvent:
    if "expected" in r:
        return r
    row = r.copy()
    row["expected"] = row.pop("output")
    return row
