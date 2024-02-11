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
    return event
