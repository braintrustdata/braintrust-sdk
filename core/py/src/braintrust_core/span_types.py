from enum import Enum


class SpanTypeAttribute(str, Enum):
    LLM = "llm"
    SCORE = "score"
    FUNCTION = "function"
    EVAL = "eval"
    TASK = "task"
    TOOL = "tool"
