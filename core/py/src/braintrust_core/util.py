import dataclasses
import json
from typing import Dict


class SerializableDataClass:
    def as_dict(self):
        """Serialize the object to a dictionary."""
        return dataclasses.asdict(self)

    def as_json(self, **kwargs):
        """Serialize the object to JSON."""
        return json.dumps(self.as_dict(), **kwargs)


def coalesce(*args):
    """Returns the first non-None value in the list of `args`, or `None` if they
    are all `None`.
    """

    for a in args:
        if a is not None:
            return a
    return None


def merge_dicts(merge_into: Dict, merge_from: Dict):
    """Merges merge_from into merge_into, destructively updating merge_into."""

    if not isinstance(merge_into, dict):
        raise ValueError("merge_into must be a dictionary")
    if not isinstance(merge_from, dict):
        raise ValueError("merge_from must be a dictionary")

    for k, merge_from_v in merge_from.items():
        merge_into_v = merge_into.get(k)
        if isinstance(merge_into_v, dict) and isinstance(merge_from_v, dict):
            merge_dicts(merge_into_v, merge_from_v)
        else:
            merge_into[k] = merge_from_v

    return merge_into
