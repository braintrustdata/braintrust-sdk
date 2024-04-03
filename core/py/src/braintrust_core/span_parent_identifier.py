# Serialization format for (object_type, object_id, row_id), which can be used
# uniquely identify a particular row as the parent of a span. Meant to be passed
# around as an opaque string.

import dataclasses
from enum import Enum

from .db_fields import PARENT_ID_FIELD


class SpanParentObjectType(Enum):
    EXPERIMENT = "experiment"
    PROJECT_LOGS = "project_logs"

    def __str__(self):
        return self.value


_OBJECT_TYPE_TO_PREFIX = {
    SpanParentObjectType.EXPERIMENT: "ex",
    SpanParentObjectType.PROJECT_LOGS: "pl",
}

_PREFIX_TO_OBJECT_TYPE = {v: k for k, v in _OBJECT_TYPE_TO_PREFIX.items()}

_SEP = ":"


@dataclasses.dataclass
class SpanParentComponents:
    object_type: SpanParentObjectType
    object_id: str
    # It is valid to describe just the parent object by setting an empty string
    # for `row_id`.
    row_id: str

    def __post_init__(self):
        assert isinstance(self.object_type, SpanParentObjectType)
        assert isinstance(self.object_id, str)
        assert isinstance(self.row_id, str)

        object_type_prefix = _OBJECT_TYPE_TO_PREFIX[self.object_type]
        assert _SEP not in object_type_prefix, object_type_prefix
        assert _SEP not in self.object_id, self.object_id

    def to_str(self):
        return _SEP.join([_OBJECT_TYPE_TO_PREFIX[self.object_type], self.object_id, self.row_id])

    @staticmethod
    def from_str(s):
        items = s.split(_SEP)

        if len(items) < 3:
            raise Exception(
                f"Serialized parent components string must have at least three components. Provided string {s} has has only {len(items)}"
            )

        # We cannot guarantee there is no separator character in the
        # user-controllable `row_id`, but since we can guarantee there is no
        # separator character in the other fields, we can still safely determine
        # the bounds of `row_id` in the serialized representation.
        return SpanParentComponents(
            object_type=_PREFIX_TO_OBJECT_TYPE[items[0]], object_id=items[1], row_id=_SEP.join(items[2:])
        )

    def as_dict(self):
        if self.object_type == SpanParentObjectType.EXPERIMENT:
            out = dict(experiment_id=self.object_id)
        elif self.object_type == SpanParentObjectType.PROJECT_LOGS:
            out = dict(project_id=self.object_id, log_id="g")
        if self.row_id:
            out[PARENT_ID_FIELD] = self.row_id
        return out
