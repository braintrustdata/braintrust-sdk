# Serialization format for capturing all relevant information about a span
# necessary for distributed logging / tracing. Meant to be passed around as an
# opaque string.

import base64
import dataclasses
import json
from enum import Enum
from uuid import UUID

from .span_identifier_v1 import SpanComponentsV1


def _try_make_uuid(s):
    try:
        ret = UUID(s).bytes
        assert len(ret) == 16
        return ret, True
    except Exception:
        return s.encode("utf-8"), False


ENCODING_VERSION_NUMBER = 2
INTEGER_ENCODING_NUM_BYTES = 4
INTEGER_ENCODING_BYTEORDER = "big"

INVALID_ENCODING_ERRMSG = f"SpanComponents string is not properly encoded. This library only supports encoding versions up to {ENCODING_VERSION_NUMBER}. Please make sure the SDK library used to decode the SpanComponents is at least as new as any library used to encode it."


class SpanObjectTypeV2(Enum):
    EXPERIMENT = 1
    PROJECT_LOGS = 2

    def __str__(self):
        return {SpanObjectTypeV2.EXPERIMENT: "experiment", SpanObjectTypeV2.PROJECT_LOGS: "project_logs"}[self]


@dataclasses.dataclass
class SpanRowIdsV2:
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
class SpanComponentsV2:
    object_type: SpanObjectTypeV2
    object_id: str | None = None
    compute_object_metadata_args: dict | None = None
    row_ids: SpanRowIdsV2 | None = None

    def __post_init__(self):
        assert isinstance(self.object_type, SpanObjectTypeV2)
        assert self.object_id or self.compute_object_metadata_args, (
            "Must provide either object_id or compute_object_metadata_args"
        )
        if self.object_id:
            assert isinstance(self.object_id, str)
        else:
            assert isinstance(self.compute_object_metadata_args, dict)
        if self.row_ids is not None:
            assert isinstance(self.row_ids, SpanRowIdsV2)

    def to_str(self) -> str:
        # Our binary object format is as follows:
        #   - Byte 0 encodes the version number of the encoded string. This is
        #   used to check for incompatibilities with previous iterations.
        #   - Byte 1 encodes the SpanObjectTypeV2.
        #   - Byte 2 (0 or 1) encodes whether or not we have an object_id.
        #   - Byte 3 (0 or 1) encodes whether or not we have
        #   compute_object_metadata_args.
        #   - Byte 4 (0 or 1) describes whether or not the (row_id,
        #   span_id, root_span_id) triple is present.
        #   - Byte 5 (0 or 1) describes whether or not the row_id component
        #   is a UUID. If not, it is assumed to be a utf-8 encoded string.
        #   - If [byte 2] == 1, the next 16 bytes encode the object_id as a UUID.
        #   - If [byte 3] == 1, the next [INTEGER_ENCODING_NUM_BYTES] bytes
        #   encode the length of the serialized compute_object_metadata_args. The next
        #   [length] bytes contain the serialized compute_object_metadata_args.
        #   - If [byte 4] == 1, the next 32 bytes encode the span_id +
        #   root_span_id as UUIDs.
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
                1 if self.object_id else 0,
                1 if self.compute_object_metadata_args else 0,
                1 if self.row_ids else 0,
                1 if row_id_is_uuid else 0,
            ]
        )

        if self.object_id:
            object_id_bytes, object_id_is_uuid = _try_make_uuid(self.object_id)
            if not object_id_is_uuid:
                raise Exception("object_id component must be a valid UUID")
            raw_bytes += object_id_bytes

        if self.compute_object_metadata_args:
            compute_object_metadata_bytes = bytes(json.dumps(self.compute_object_metadata_args).encode())
            serialized_len_bytes = len(compute_object_metadata_bytes).to_bytes(
                INTEGER_ENCODING_NUM_BYTES, byteorder=INTEGER_ENCODING_BYTEORDER
            )
            raw_bytes += serialized_len_bytes
            raw_bytes += compute_object_metadata_bytes

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
    def from_str(s: str) -> "SpanComponentsV2":
        try:
            raw_bytes = base64.b64decode(s.encode())

            if raw_bytes[0] < ENCODING_VERSION_NUMBER:
                span_components_old = SpanComponentsV1.from_str(s)
                object_type = SpanObjectTypeV2(span_components_old.object_type.value)
                if span_components_old.row_ids:
                    row_ids = SpanRowIdsV2(
                        row_id=span_components_old.row_ids.row_id,
                        span_id=span_components_old.row_ids.span_id,
                        root_span_id=span_components_old.row_ids.root_span_id,
                    )
                else:
                    row_ids = None
                return SpanComponentsV2(
                    object_type=object_type, object_id=span_components_old.object_id, row_ids=row_ids
                )

            assert raw_bytes[0] == ENCODING_VERSION_NUMBER
            object_type = SpanObjectTypeV2(raw_bytes[1])
            for i in range(2, 6):
                assert raw_bytes[i] in [0, 1]
            has_object_id = raw_bytes[2]
            has_compute_object_metadata_args = raw_bytes[3]
            has_row_id = raw_bytes[4] == 1
            row_id_is_uuid = raw_bytes[5] == 1

            byte_cursor = 6
            if has_object_id:
                next_byte_cursor = byte_cursor + 16
                object_id = str(UUID(bytes=raw_bytes[byte_cursor:next_byte_cursor]))
                byte_cursor = next_byte_cursor
            else:
                object_id = None

            if has_compute_object_metadata_args:
                next_byte_cursor = byte_cursor + INTEGER_ENCODING_NUM_BYTES
                serialized_len_bytes = int.from_bytes(
                    raw_bytes[byte_cursor:next_byte_cursor], byteorder=INTEGER_ENCODING_BYTEORDER
                )
                byte_cursor = next_byte_cursor
                next_byte_cursor = byte_cursor + serialized_len_bytes
                compute_object_metadata_args = json.loads(raw_bytes[byte_cursor:next_byte_cursor].decode())
                byte_cursor = next_byte_cursor
            else:
                compute_object_metadata_args = None

            if has_row_id:
                next_byte_cursor = byte_cursor + 16
                span_id = str(UUID(bytes=raw_bytes[byte_cursor:next_byte_cursor]))
                byte_cursor = next_byte_cursor
                next_byte_cursor = byte_cursor + 16
                root_span_id = str(UUID(bytes=raw_bytes[byte_cursor:next_byte_cursor]))
                byte_cursor = next_byte_cursor
                if row_id_is_uuid:
                    row_id = str(UUID(bytes=raw_bytes[byte_cursor:]))
                else:
                    row_id = raw_bytes[byte_cursor:].decode("utf-8")
                row_ids = SpanRowIdsV2(row_id=row_id, span_id=span_id, root_span_id=root_span_id)
            else:
                row_ids = None

            return SpanComponentsV2(
                object_type=object_type,
                object_id=object_id,
                compute_object_metadata_args=compute_object_metadata_args,
                row_ids=row_ids,
            )
        except Exception:
            raise Exception(INVALID_ENCODING_ERRMSG)

    def object_id_fields(self):
        if not self.object_id:
            raise Exception(
                "Impossible: cannot invoke `object_id_fields` unless SpanComponentsV2 is initialized with an `object_id`"
            )
        if self.object_type == SpanObjectTypeV2.EXPERIMENT:
            return dict(experiment_id=self.object_id)
        elif self.object_type == SpanObjectTypeV2.PROJECT_LOGS:
            return dict(project_id=self.object_id, log_id="g")
