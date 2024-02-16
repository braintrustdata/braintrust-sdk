from .db_fields import MERGE_PATHS_FIELD

DEFAULT_IS_LEGACY_DATASET = True


def ensure_dataset_record(r, legacy: bool):
    if legacy:
        return ensure_legacy_dataset_record(r)
    else:
        return ensure_new_dataset_record(r)


def ensure_legacy_dataset_record(r):
    if "output" in r:
        return r
    row = {**r}
    row["output"] = row.pop("expected")
    return row


def ensure_new_dataset_record(r):
    if "expected" in r:
        return r
    row = {**r}
    row["expected"] = row.pop("output")
    return row


def make_legacy_event(e):
    if "dataset_id" not in e or "expected" not in e:
        return e

    event = {**e}
    event["output"] = event.pop("expected")

    if MERGE_PATHS_FIELD in event:
        for path in event[MERGE_PATHS_FIELD] or []:
            if len(path) > 0 and path[0] == "expected":
                path[0] = "output"

    return event
