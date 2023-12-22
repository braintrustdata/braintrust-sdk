# Format and utils for serializing objects to create spans later. Keep this in
# sync with the span serialization implementation in logger.ts.

import dataclasses
from typing import Union


@dataclasses.dataclass
class SpanExperimentIds:
    project_id: str
    experiment_id: str


@dataclasses.dataclass
class SpanProjectLogIds:
    org_id: str
    project_id: str
    log_id: str


@dataclasses.dataclass
class SpanParentSubSpanIds:
    span_id: str
    root_span_id: str


@dataclasses.dataclass
class SpanParentRootSpanIds:
    span_id: str


@dataclasses.dataclass
class SerializedSpanInfo:
    object_ids: Union[SpanExperimentIds, SpanProjectLogIds]
    span_parent_ids: Union[SpanParentSubSpanIds, SpanParentRootSpanIds, None]


def serialized_span_info_to_string(info: SerializedSpanInfo) -> str:
    ids = info.object_ids
    if isinstance(ids, SpanExperimentIds):
        object_ids = ["e", ids.project_id, ids.experiment_id]
    elif isinstance(ids, SpanProjectLogIds):
        object_ids = ["pl", ids.org_id, ids.project_id]
    else:
        raise Exception(f"Unknown object_ids value {ids}")

    ids = info.span_parent_ids
    if isinstance(ids, SpanParentSubSpanIds):
        span_parent_ids = [ids.span_id, ids.root_span_id]
    elif isinstance(ids, SpanParentRootSpanIds):
        span_parent_ids = [ids.span_id, ""]
    elif ids is None:
        span_parent_ids = ["", ""]
    else:
        raise Exception(f"Unknown span_parent_ids value {ids}")

    ids = object_ids + span_parent_ids
    # Since all of these IDs are auto-generated as UUIDs, we can expect them to
    # not contain any colons.
    for id in ids:
        if ":" in id:
            raise Exception(f"Unexpected: id {id} should not have a ':'")
    return ":".join(ids)


def serialized_span_info_from_string(s: str) -> SerializedSpanInfo:
    ids = s.split(":")
    if len(ids) != 5:
        raise Exception(f"Expected serialized info {s} to have 5 colon-separated components")

    if ids[0] == "e":
        object_ids = SpanExperimentIds(project_id=ids[1], experiment_id=ids[2])
    elif ids[0] == "pl":
        object_ids = SpanProjectLogIds(org_id=ids[1], project_id=ids[2], log_id="g")
    else:
        raise Exception(f"Unknown serialized object kind {ids[0]}")

    if ids[4] == "":
        if ids[3] == "":
            span_parent_ids = None
        else:
            span_parent_ids = SpanParentRootSpanIds(span_id=ids[3])
    else:
        span_parent_ids = SpanParentSubSpanIds(span_id=ids[3], root_span_id=ids[4])

    return SerializedSpanInfo(object_ids=object_ids, span_parent_ids=span_parent_ids)
