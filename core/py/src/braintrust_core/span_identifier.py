# Serialization format for capturing all relevant information about a span
# necessary for distributed logging / tracing. Meant to be passed around as an
# opaque string.

import base64
import dataclasses
from enum import Enum, auto
from typing import Optional
from uuid import UUID


def _try_make_uuid(s):
    try:
        ret = UUID(s).bytes
        assert len(ret) == 16
        return ret, True
    except Exception:
        return s.encode("utf-8"), False


ENCODING_VERSION_NUMBER = 1

INVALID_ENCODING_ERRMSG = "SpanComponents string is not properly encoded. This may be due to a version mismatch between the SDK library used to export the span and the library used to decode it. Please make sure you are using the same SDK version across the board"


class SpanObjectType(Enum):
    EXPERIMENT = auto()
    PROJECT_LOGS = auto()

    def __str__(self):
        return {SpanObjectType.EXPERIMENT: "experiment", SpanObjectType.PROJECT_LOGS: "project_logs"}[self]


@dataclasses.dataclass
class SpanRowIds:
    row_id: str
    span_id: str
    root_span_id: str

    def __post_init__(self):
        assert isinstance(self.row_id, str)
        assert isinstance(self.span_id, str)
        assert isinstance(self.root_span_id, str)
        assert self.row_id
        assert self.span_id
        assert self.root_span_id


@dataclasses.dataclass
class SpanComponents:
    object_type: SpanObjectType
    object_id: str
    row_ids: Optional[SpanRowIds] = None

    def __post_init__(self):
        assert isinstance(self.object_type, SpanObjectType)
        assert isinstance(self.object_id, str)
        if self.row_ids is not None:
            assert isinstance(self.row_ids, SpanRowIds)

    def to_str(self) -> str:
        # Our binary object format is as follows:
        #   - Byte 0 encodes the version number of the encoded string. This is
        #   used to check for incompatibilities with previous iterations.
        #   - Byte 1 encodes the SpanObjectType.
        #   - Byte 2 (0 or 1) describes whether or not the (row_id,
        #   span_id, root_span_id) triple is present.
        #   - Byte 3 (0 or 1) describes whether or not the row_id component
        #   is a UUID. If not, it is assumed to be a utf-8 encoded string.
        #   - Bytes 4-19 encode the object_id as a UUID
        #   - If the row triple is present, bytes 20-51 encode the span_id +
        #   root_span_id as a UUID.
        #   - If the row triple is present, the remaining bytes encode the
        #   row_id either as UUID or as UTF-8.

        if self.row_ids:
            row_id_bytes, row_id_is_uuid = _try_make_uuid(self.row_ids.row_id)
        else:
            row_id_bytes, row_id_is_uuid = None, False

        raw_bytes = bytes(
            [
                ENCODING_VERSION_NUMBER,
                self.object_type.value,
                1 if self.row_ids else 0,
                1 if row_id_is_uuid else 0,
            ]
        )

        object_id_bytes, object_id_is_uuid = _try_make_uuid(self.object_id)
        if not object_id_is_uuid:
            raise Exception("object_id component must be a valid UUID")
        raw_bytes += object_id_bytes

        if self.row_ids:
            span_id_bytes, span_id_is_uuid = _try_make_uuid(self.row_ids.span_id)
            if not span_id_is_uuid:
                raise Exception("span_id component must be a valid UUID")
            root_span_id_bytes, root_span_id_is_uuid = _try_make_uuid(self.row_ids.root_span_id)
            if not root_span_id_is_uuid:
                raise Exception("root_span_id component must be a valid UUID")
            raw_bytes += span_id_bytes
            raw_bytes += root_span_id_bytes
            raw_bytes += row_id_bytes

        return base64.b64encode(raw_bytes).decode()

    @staticmethod
    def from_str(s: str) -> "SpanComponents":
        try:
            raw_bytes = base64.b64decode(s.encode())
            assert raw_bytes[0] == ENCODING_VERSION_NUMBER
            object_type = SpanObjectType(raw_bytes[1])
            assert raw_bytes[2] in [0, 1]
            assert raw_bytes[3] in [0, 1]
            has_row_id = raw_bytes[2] == 1
            row_id_is_uuid = raw_bytes[3] == 1

            object_id = str(UUID(bytes=raw_bytes[4:20]))
            if has_row_id:
                span_id = str(UUID(bytes=raw_bytes[20:36]))
                root_span_id = str(UUID(bytes=raw_bytes[36:52]))
                if row_id_is_uuid:
                    row_id = str(UUID(bytes=raw_bytes[52:]))
                else:
                    row_id = raw_bytes[52:].decode("utf-8")
                row_ids = SpanRowIds(row_id=row_id, span_id=span_id, root_span_id=root_span_id)
            else:
                row_ids = None

            return SpanComponents(object_type=object_type, object_id=object_id, row_ids=row_ids)
        except Exception:
            raise Exception(INVALID_ENCODING_ERRMSG)

    def object_id_fields(self):
        if self.object_type == SpanObjectType.EXPERIMENT:
            return dict(experiment_id=self.object_id)
        elif self.object_type == SpanObjectType.PROJECT_LOGS:
            return dict(project_id=self.object_id, log_id="g")
