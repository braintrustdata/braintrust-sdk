# SpanComponentsV4: JSON + gzip serialization with abbreviated field names
# Treats all IDs as opaque strings - no assumptions about format

import base64
import dataclasses
import gzip
import json
from typing import Dict, Optional, Union

from .span_identifier_v3 import (
    SpanComponentsV3,
    SpanObjectTypeV3,
)

ENCODING_VERSION_NUMBER_V4 = 4



# Abbreviated field names for compact serialization
class FieldNames:
    VERSION = "v"                    # version
    OBJECT_TYPE = "t"               # object_type
    OBJECT_ID = "o"                 # object_id
    COMPUTE_OBJECT_METADATA = "c"   # compute_object_metadata_args
    ROW_ID = "r"                    # row_id
    SPAN_ID = "s"                   # span_id
    ROOT_SPAN_ID = "R"              # root_span_id
    PROPAGATED_EVENT = "p"          # propagated_event


@dataclasses.dataclass
class SpanComponentsV4:
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
        # Create a dict with abbreviated field names to save space
        data = {
            FieldNames.VERSION: ENCODING_VERSION_NUMBER_V4,
            FieldNames.OBJECT_TYPE: self.object_type.value,
        }

        if self.object_id is not None:
            data[FieldNames.OBJECT_ID] = self.object_id
        if self.compute_object_metadata_args is not None:
            data[FieldNames.COMPUTE_OBJECT_METADATA] = self.compute_object_metadata_args
        if self.row_id is not None:
            data[FieldNames.ROW_ID] = self.row_id
        if self.span_id is not None:
            data[FieldNames.SPAN_ID] = self.span_id
        if self.root_span_id is not None:
            data[FieldNames.ROOT_SPAN_ID] = self.root_span_id
        if self.propagated_event is not None:
            data[FieldNames.PROPAGATED_EVENT] = self.propagated_event

        # Serialize as JSON + gzip compression
        json_str = json.dumps(data, separators=(',', ':'))
        compressed = gzip.compress(json_str.encode())
        return base64.b64encode(compressed).decode()

    @staticmethod
    def from_str(s: str) -> "SpanComponentsV4":
        try:
            raw_bytes = base64.b64decode(s.encode())

            # Try to decode as V4 format (compressed JSON)
            try:
                decompressed = gzip.decompress(raw_bytes)
                json_str = decompressed.decode()
                data = json.loads(json_str)
                if isinstance(data, dict) and data.get(FieldNames.VERSION) == ENCODING_VERSION_NUMBER_V4:
                    return SpanComponentsV4(
                        object_type=SpanObjectTypeV3(data[FieldNames.OBJECT_TYPE]),
                        object_id=data.get(FieldNames.OBJECT_ID),
                        compute_object_metadata_args=data.get(FieldNames.COMPUTE_OBJECT_METADATA),
                        row_id=data.get(FieldNames.ROW_ID),
                        span_id=data.get(FieldNames.SPAN_ID),
                        root_span_id=data.get(FieldNames.ROOT_SPAN_ID),
                        propagated_event=data.get(FieldNames.PROPAGATED_EVENT),
                    )
            except:
                pass

            # Fall back to V3 compatibility
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
        except Exception as e:
            v4_errmsg = f"SpanComponents string is not properly encoded. This library only supports encoding versions up to {ENCODING_VERSION_NUMBER_V4}. Please make sure the SDK library used to decode the SpanComponents is at least as new as any library used to encode it."
            raise Exception(v4_errmsg) from e

    def object_id_fields(self) -> Dict[str, str]:
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



def parse_parent(parent: Union[str, Dict, None]) -> Optional[str]:
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
            kwargs.update({
                "row_id": row_ids.get("id"),
                "span_id": row_ids.get("span_id"),
                "root_span_id": row_ids.get("root_span_id"),
            })
        else:
            kwargs.update({
                "row_id": None,
                "span_id": None,
                "root_span_id": None,
            })

        if "propagated_event" in parent:
            kwargs["propagated_event"] = parent.get("propagated_event")

        return SpanComponentsV4(**kwargs).to_str()
    else:
        return None
