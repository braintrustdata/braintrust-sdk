import dataclasses
import json
from typing import Dict, Set, Tuple


class SerializableDataClass:
    def as_dict(self):
        """Serialize the object to a dictionary."""
        return dataclasses.asdict(self)

    def as_json(self, **kwargs):
        """Serialize the object to JSON."""
        return json.dumps(self.as_dict(), **kwargs)

    @classmethod
    def from_dict(cls, d: Dict):
        """Deserialize the object from a dictionary. This method
        is shallow and will not call from_dict() on nested objects."""
        fields = {f.name: f for f in dataclasses.fields(cls)}
        filtered = {}
        for k, v in d.items():
            if k in fields:
                assert isinstance(type(v), fields[k].type)
                filtered[k] = v
        return cls(**filtered)


def coalesce(*args):
    """Returns the first non-None value in the list of `args`, or `None` if they
    are all `None`.
    """

    for a in args:
        if a is not None:
            return a
    return None


def merge_dicts_with_paths(merge_into: Dict, merge_from: Dict, path: Tuple[str], merge_paths: Set[Tuple[str]]):
    """Merges merge_from into merge_into, destructively updating merge_into. Does not merge any further than
    merge_paths."""

    if not isinstance(merge_into, dict):
        raise ValueError("merge_into must be a dictionary")
    if not isinstance(merge_from, dict):
        raise ValueError("merge_from must be a dictionary")

    for k, merge_from_v in merge_from.items():
        full_path = path + (k,)
        merge_into_v = merge_into.get(k)
        if isinstance(merge_into_v, dict) and isinstance(merge_from_v, dict) and full_path not in merge_paths:
            merge_dicts_with_paths(merge_into_v, merge_from_v, full_path, merge_paths)
        else:
            merge_into[k] = merge_from_v

    return merge_into


def merge_dicts(merge_into: Dict, merge_from: Dict):
    """Merges merge_from into merge_into, destructively updating merge_into."""

    return merge_dicts_with_paths(merge_into, merge_from, (), set())
