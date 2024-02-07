import json


def patch_legacy_dataset(r):
    row = {**r}
    output = row.pop("output", None)
    if "expected" not in row:
        row["expected"] = output
    return row


def patch_legacy_record(r):
    if "dataset_id" not in r:
        return r
    return patch_legacy_dataset(r)


def make_legacy_dataset(r):
    row = {**r}
    expected = row.pop("expected", None)
    if "output" not in row:
        row["output"] = expected
    return row


def make_legacy_record(r):
    if "dataset_id" not in r:
        return r
    return make_legacy_dataset(r)
