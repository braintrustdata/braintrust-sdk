def patch_legacy_dataset_record(r):
    row = {**r}
    if "output" in row and "expected" not in row:
        row["expected"] = row.pop("output")
    return row


def make_legacy_dataset_record(r):
    row = {**r}
    if "expected" in row and "output" not in row:
        row["output"] = row.pop("expected")
    return row


def make_legacy_event(r):
    if "dataset_id" not in r:
        return r
    return make_legacy_dataset_record(r)
