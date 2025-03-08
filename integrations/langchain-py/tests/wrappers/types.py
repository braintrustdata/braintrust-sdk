from typing import Any, List, Optional, TypedDict


class SpanAttributes(TypedDict):
    name: str
    type: Optional[str]


class SpanMetadata(TypedDict, total=False):
    tags: List[str]
    model: str
    temperature: float
    top_p: float
    frequency_penalty: float
    presence_penalty: float
    n: int
    runId: Optional[str]


class SpanRequired(TypedDict):
    span_id: str


class Span(SpanRequired, total=False):
    span_attributes: SpanAttributes
    input: Any
    output: Any
    span_parents: Optional[List[str]]
    metadata: SpanMetadata


class LogRequest(TypedDict):
    rows: List[Span]
