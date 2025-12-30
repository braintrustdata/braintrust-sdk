# SpanComponentsV4: Binary serialization like V3 but with hex string compression
# Uses 16-byte encoding for trace IDs and 8-byte encoding for span IDs

import base64
import dataclasses
import json
from enum import Enum

from .span_identifier_v3 import (
    SpanComponentsV3,
    SpanObjectTypeV3,
)

ENCODING_VERSION_NUMBER_V4 = 4


def _try_make_hex_trace_id(s):
    """Try to convert hex string to 16-byte binary (for trace IDs)"""
    try:
        if isinstance(s, str) and len(s) == 32:  # 32 hex chars = 16 bytes
            ret = bytes.fromhex(s)
            assert len(ret) == 16
            return ret, True
    except Exception:
        pass
    return None, False


def _try_make_hex_span_id(s):
    """Try to convert hex string to 8-byte binary (for span IDs)"""
    try:
        if isinstance(s, str) and len(s) == 16:  # 16 hex chars = 8 bytes
            ret = bytes.fromhex(s)
            assert len(ret) == 8
            return ret, True
    except Exception:
        pass
    return None, False


INVALID_ENCODING_ERRMSG_V4 = f"SpanComponents string is not properly encoded. This library only supports encoding versions up to {ENCODING_VERSION_NUMBER_V4}. Please make sure the SDK library used to decode the SpanComponents is at least as new as any library used to encode it."


class Fields(Enum):
    OBJECT_ID = 1
    ROW_ID = 2
    SPAN_ID = 3  # 8-byte hex
    ROOT_SPAN_ID = 4  # 16-byte hex


_FIELDS_ID_TO_NAME = {
    Fields.OBJECT_ID: "object_id",
    Fields.ROW_ID: "row_id",
    Fields.SPAN_ID: "span_id",
    Fields.ROOT_SPAN_ID: "root_span_id",
}


@dataclasses.dataclass
class SpanComponentsV4:
    object_type: SpanObjectTypeV3

    # Must provide one or the other.
    object_id: str | None = None
    compute_object_metadata_args: dict | None = None

    # Either all of these must be provided or none.
    row_id: str | None = None
    span_id: str | None = None
    root_span_id: str | None = None

    # Additional span properties.
    propagated_event: dict | None = None

    def __post_init__(self):
        # Reuse V3 validation logic
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
        # V3-style binary encoding with hex string compression
        # Binary format: version_byte + object_type_byte + num_hex_fields + hex_entries + json_remainder
        json_obj = dict(
            compute_object_metadata_args=self.compute_object_metadata_args or None,
            propagated_event=self.propagated_event or None,
        )
        json_obj = {k: v for k, v in json_obj.items() if v is not None}

        raw_bytes = bytes(
            [
                ENCODING_VERSION_NUMBER_V4,
                self.object_type.value,
            ]
        )

        hex_entries = []

        def add_hex_field(orig_val, field_id):
            nonlocal hex_entries

            if field_id == Fields.SPAN_ID:
                hex_bytes, is_hex = _try_make_hex_span_id(orig_val)
            elif field_id == Fields.ROOT_SPAN_ID:
                hex_bytes, is_hex = _try_make_hex_trace_id(orig_val)
            else:
                hex_bytes, is_hex = None, False

            if is_hex:
                hex_entries.append(bytes([field_id.value]) + hex_bytes)
            else:
                json_obj[_FIELDS_ID_TO_NAME[field_id]] = orig_val

        if self.object_id:
            add_hex_field(self.object_id, Fields.OBJECT_ID)
        if self.row_id:
            add_hex_field(self.row_id, Fields.ROW_ID)
        if self.span_id:
            add_hex_field(self.span_id, Fields.SPAN_ID)
        if self.root_span_id:
            add_hex_field(self.root_span_id, Fields.ROOT_SPAN_ID)

        if len(hex_entries) > 255:
            raise Exception("Impossible: too many hex entries to encode")
        raw_bytes += bytes([len(hex_entries)])
        for entry in hex_entries:
            raw_bytes += entry
        if json_obj:
            raw_bytes += bytes(json.dumps(json_obj, separators=(",", ":")).encode())
        return base64.b64encode(raw_bytes).decode()

    @staticmethod
    def get_version(slug: str) -> int:
        """
        Extract the encoding version number from a serialized span components slug.

        :param slug: Base64-encoded span components string
        :returns: Version number (3 for V3, 4 for V4, etc.)
        """
        raw_bytes = base64.b64decode(slug)
        return raw_bytes[0]

    @staticmethod
    def from_str(s: str) -> "SpanComponentsV4":
        try:
            raw_bytes = base64.b64decode(s.encode())
            json_obj = {}

            if raw_bytes[0] < ENCODING_VERSION_NUMBER_V4:
                # Handle older versions by delegating to V3
                v3_components = SpanComponentsV3.from_str(s)
                return SpanComponentsV4(
                    object_type=v3_components.object_type,
                    object_id=v3_components.object_id,
                    compute_object_metadata_args=v3_components.compute_object_metadata_args,
                    row_id=v3_components.row_id,
                    span_id=v3_components.span_id,
                    root_span_id=v3_components.root_span_id,
                    propagated_event=v3_components.propagated_event,
                )
            else:
                # V4 binary format
                json_obj["object_type"] = SpanObjectTypeV3(raw_bytes[1])
                num_hex_entries = raw_bytes[2]
                byte_offset = 3

                for i in range(num_hex_entries):
                    field_id = Fields(raw_bytes[byte_offset])
                    if field_id == Fields.SPAN_ID:
                        # 8-byte span ID
                        hex_bytes = raw_bytes[byte_offset + 1 : byte_offset + 9]
                        byte_offset += 9
                        json_obj[_FIELDS_ID_TO_NAME[field_id]] = hex_bytes.hex()
                    elif field_id == Fields.ROOT_SPAN_ID:
                        # 16-byte trace ID
                        hex_bytes = raw_bytes[byte_offset + 1 : byte_offset + 17]
                        byte_offset += 17
                        json_obj[_FIELDS_ID_TO_NAME[field_id]] = hex_bytes.hex()
                    else:
                        # Should not happen for object_id/row_id in V4, but handle gracefully
                        hex_bytes = raw_bytes[byte_offset + 1 : byte_offset + 17]  # assume 16 bytes
                        byte_offset += 17
                        json_obj[_FIELDS_ID_TO_NAME[field_id]] = hex_bytes.hex()

                if byte_offset < len(raw_bytes):
                    remaining_json_obj = json.loads(raw_bytes[byte_offset:].decode())
                    json_obj.update(remaining_json_obj)

            return SpanComponentsV4._from_json_obj(json_obj)
        except Exception:
            raise Exception(INVALID_ENCODING_ERRMSG_V4)

    def object_id_fields(self) -> dict[str, str]:
        # Reuse V3 logic
        if not self.object_id:
            raise Exception(
                "Impossible: cannot invoke `object_id_fields` unless SpanComponentsV4 is initialized with an `object_id`"
            )
        if self.object_type == SpanObjectTypeV3.EXPERIMENT:
            return dict(experiment_id=self.object_id)
        elif self.object_type == SpanObjectTypeV3.PROJECT_LOGS:
            return dict(project_id=self.object_id, log_id="g")
        elif self.object_type == SpanObjectTypeV3.PLAYGROUND_LOGS:
            return dict(prompt_session_id=self.object_id, log_id="x")
        else:
            raise Exception(f"Invalid object_type {self.object_type}")

    def export(self) -> str:
        return self.to_str()

    @staticmethod
    def _from_json_obj(json_obj: dict) -> "SpanComponentsV4":
        kwargs = {
            **json_obj,
            "object_type": SpanObjectTypeV3(json_obj["object_type"]),
        }
        return SpanComponentsV4(**kwargs)


def parse_parent(parent: str | dict | None) -> str | None:
    """Parse a parent object into a string representation using V4 format."""
    # Reuse V3 logic but with V4 components
    if isinstance(parent, str):
        return parent
    elif parent:
        object_type_map = {
            "experiment": SpanObjectTypeV3.EXPERIMENT,
            "playground_logs": SpanObjectTypeV3.PLAYGROUND_LOGS,
            "project_logs": SpanObjectTypeV3.PROJECT_LOGS,
        }

        object_type = object_type_map.get(parent.get("object_type"))
        if not object_type:
            raise ValueError(f"Invalid object_type: {parent.get('object_type')}")

        kwargs = {
            "object_type": object_type,
            "object_id": parent.get("object_id"),
        }

        row_ids = parent.get("row_ids")
        if row_ids:
            kwargs.update(
                {
                    "row_id": row_ids.get("id"),
                    "span_id": row_ids.get("span_id"),
                    "root_span_id": row_ids.get("root_span_id"),
                }
            )
        else:
            kwargs.update(
                {
                    "row_id": None,
                    "span_id": None,
                    "root_span_id": None,
                }
            )

        if "propagated_event" in parent:
            kwargs["propagated_event"] = parent.get("propagated_event")

        return SpanComponentsV4(**kwargs).to_str()
    else:
        return None
