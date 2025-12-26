from enum import Enum


class SpanTypeAttribute(str, Enum):
    """
    Use `SpanType` instead.
    :deprecated:
    """

    LLM = "llm"
    SCORE = "score"
    FUNCTION = "function"
    EVAL = "eval"
    TASK = "task"
    TOOL = "tool"
    AUTOMATION = "automation"
    FACET = "facet"


class SpanPurpose(str, Enum):
    SCORER = "scorer"
