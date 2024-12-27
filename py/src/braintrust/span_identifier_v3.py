# Serialization format for capturing all relevant information about a span
# necessary for distributed logging / tracing. Meant to be passed around as an
# opaque string.

import base64
import dataclasses
import json
from enum import Enum
from typing import Dict, Optional
from uuid import UUID

from .span_identifier_v2 import SpanComponentsV2
from .util import coalesce


def _try_make_uuid(s):
    try:
        ret = UUID(s).bytes
        assert len(ret) == 16
        return ret, True
    except Exception:
        return None, False


ENCODING_VERSION_NUMBER = 3

INVALID_ENCODING_ERRMSG = f"SpanComponents string is not properly encoded. This library only supports encoding versions up to {ENCODING_VERSION_NUMBER}. Please make sure the SDK library used to decode the SpanComponents is at least as new as any library used to encode it."


class SpanObjectTypeV3(Enum):
    EXPERIMENT = 1
    PROJECT_LOGS = 2
    PLAYGROUND_LOGS = 3

    def __str__(self):
        return {
            SpanObjectTypeV3.EXPERIMENT: "experiment",
            SpanObjectTypeV3.PROJECT_LOGS: "project_logs",
            SpanObjectTypeV3.PLAYGROUND_LOGS: "playground_logs",
        }[self]


class InternalSpanComponentUUIDFields(Enum):
    OBJECT_ID = 1
    ROW_ID = 2
    SPAN_ID = 3
    ROOT_SPAN_ID = 4


_INTERNAL_SPAN_COMPONENT_UUID_FIELDS_ID_TO_NAME = {
    InternalSpanComponentUUIDFields.OBJECT_ID: "object_id",
    InternalSpanComponentUUIDFields.ROW_ID: "row_id",
    InternalSpanComponentUUIDFields.SPAN_ID: "span_id",
    InternalSpanComponentUUIDFields.ROOT_SPAN_ID: "root_span_id",
}


@dataclasses.dataclass
class SpanComponentsV3:
    object_type: SpanObjectTypeV3

    # Must provide one or the other.
    object_id: Optional[str] = None
    compute_object_metadata_args: Optional[Dict] = None

    # Either all of these must be provided or none.
    row_id: Optional[str] = None
    span_id: Optional[str] = None
    root_span_id: Optional[str] = None

    # Additional span properties.
    propagated_event: Optional[Dict] = None

    def __post_init__(self):
        assert isinstance(self.object_type, SpanObjectTypeV3)

        assert not (self.object_id and self.compute_object_metadata_args)
        assert self.object_id or self.compute_object_metadata_args
        if self.object_id is not None:
            assert isinstance(self.object_id, str)
        elif self.compute_object_metadata_args:
            assert isinstance(self.compute_object_metadata_args, dict)

        if self.row_id:
            assert isinstance(self.row_id, str)
            assert self.span_id
            assert isinstance(self.span_id, str)
            assert self.root_span_id
            assert isinstance(self.root_span_id, str)
        else:
            assert not self.span_id
            assert not self.root_span_id

    def to_str(self) -> str:
        # Our binary object format is as follows:
        #   - Byte 0 encodes the version number of the encoded string. This is
        #   used to check for incompatibilities with previous iterations.
        #   - Byte 1 encodes the SpanObjectTypeV3.
        #   - Byte 2 encodes the number of UUID fields we have serialized in a
        #   compressed form.
        #   - For each of the specially-serialized UUID fields, we encode one
        #   byte for InternalSpanComponentUUIDFields, denoting which field it
        #   is, followed by the 16 bytes of the UUID.
        #   - The remaining bytes encode the remaining object properties in JSON
        #   format, or nothing if the JSON object is empty.
        json_obj = dict(
            compute_object_metadata_args=self.compute_object_metadata_args or None,
            propagated_event=self.propagated_event or None,
        )
        json_obj = {k: v for k, v in json_obj.items() if v is not None}
        raw_bytes = bytes(
            [
                ENCODING_VERSION_NUMBER,
                self.object_type.value,
            ]
        )

        uuid_entries = []

        def add_uuid_field(orig_val, field_id):
            nonlocal uuid_entries

            uuid_bytes, is_uuid = _try_make_uuid(orig_val)
            if is_uuid:
                uuid_entries.append(bytes([field_id.value]) + uuid_bytes)
            else:
                json_obj[_INTERNAL_SPAN_COMPONENT_UUID_FIELDS_ID_TO_NAME[field_id]] = orig_val

        if self.object_id:
            add_uuid_field(self.object_id, InternalSpanComponentUUIDFields.OBJECT_ID)
        if self.row_id:
            add_uuid_field(self.row_id, InternalSpanComponentUUIDFields.ROW_ID)
        if self.span_id:
            add_uuid_field(self.span_id, InternalSpanComponentUUIDFields.SPAN_ID)
        if self.root_span_id:
            add_uuid_field(self.root_span_id, InternalSpanComponentUUIDFields.ROOT_SPAN_ID)

        if len(uuid_entries) > 255:
            raise Exception("Impossible: too many UUID entries to encode")
        raw_bytes += bytes([len(uuid_entries)])
        for entry in uuid_entries:
            raw_bytes += entry
        if json_obj:
            raw_bytes += bytes(json.dumps(json_obj, separators=(",", ":")).encode())
        return base64.b64encode(raw_bytes).decode()

    @staticmethod
    def from_str(s: str) -> "SpanComponentsV3":
        try:
            raw_bytes = base64.b64decode(s.encode())
            json_obj = {}
            if raw_bytes[0] < ENCODING_VERSION_NUMBER:
                span_components_old = SpanComponentsV2.from_str(s)
                json_obj["object_type"] = span_components_old.object_type.value
                json_obj["object_id"] = span_components_old.object_id
                json_obj["compute_object_metadata_args"] = span_components_old.compute_object_metadata_args
                if span_components_old.row_ids:
                    json_obj["row_id"] = span_components_old.row_ids.row_id
                    json_obj["span_id"] = span_components_old.row_ids.span_id
                    json_obj["root_span_id"] = span_components_old.row_ids.root_span_id
            else:
                json_obj["object_type"] = SpanObjectTypeV3(raw_bytes[1])
                num_uuid_entries = raw_bytes[2]
                byte_offset = 3
                for i in range(num_uuid_entries):
                    field_id = InternalSpanComponentUUIDFields(raw_bytes[byte_offset])
                    uuid_bytes = raw_bytes[byte_offset + 1 : byte_offset + 17]
                    byte_offset += 17
                    json_obj[_INTERNAL_SPAN_COMPONENT_UUID_FIELDS_ID_TO_NAME[field_id]] = str(UUID(bytes=uuid_bytes))
                if byte_offset < len(raw_bytes):
                    remaining_json_obj = json.loads(raw_bytes[byte_offset:].decode())
                    json_obj.update(remaining_json_obj)
            return SpanComponentsV3._from_json_obj(json_obj)
        except Exception:
            raise Exception(INVALID_ENCODING_ERRMSG)

    def object_id_fields(self) -> Dict[str, str]:
        if not self.object_id:
            raise Exception(
                "Impossible: cannot invoke `object_id_fields` unless SpanComponentsV3 is initialized with an `object_id`"
            )
        if self.object_type == SpanObjectTypeV3.EXPERIMENT:
            return dict(experiment_id=self.object_id)
        elif self.object_type == SpanObjectTypeV3.PROJECT_LOGS:
            return dict(project_id=self.object_id, log_id="g")
        elif self.object_type == SpanObjectTypeV3.PLAYGROUND_LOGS:
            return dict(prompt_session_id=self.object_id, log_id="x")
        else:
            raise Exception(f"Invalid object_type {self.object_type}")

    @staticmethod
    def _from_json_obj(json_obj: Dict) -> "SpanComponentsV3":
        kwargs = {
            **json_obj,
            "object_type": SpanObjectTypeV3(json_obj["object_type"]),
        }
        return SpanComponentsV3(**kwargs)
