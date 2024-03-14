from dataclasses import dataclass
from typing import Dict, List, Literal, Optional, Union

from .util import SerializableDataClass


@dataclass
class PromptCompletionBlock(SerializableDataClass):
    content: str
    type: Literal["completion"] = "completion"


@dataclass
class FunctionCall(SerializableDataClass):
    name: str
    arguments: str


@dataclass
class ToolCall(SerializableDataClass):
    id: str
    function: FunctionCall
    type: Literal["function"] = "function"


@dataclass
class PromptMessage(SerializableDataClass):
    content: str
    role: Literal["system", "user", "assistant", "function", "tool", "model"]
    name: str = None
    function_call: Union[str, FunctionCall] = None
    tool_calls: Optional[List[ToolCall]] = None


@dataclass
class PromptChatBlock(SerializableDataClass):
    messages: List[PromptMessage]
    tools: Optional[str] = None
    type: Literal["chat"] = "chat"


PromptBlockData = Union[PromptCompletionBlock, PromptChatBlock]


@dataclass
class PromptData(SerializableDataClass):
    prompt: Optional[PromptBlockData] = None
    options: Optional[Dict] = None


@dataclass
class PromptSchema(SerializableDataClass):
    id: str
    project_id: str
    _xact_id: str
    name: str
    slug: str
    description: Optional[str]
    prompt_data: PromptData
    tags: Optional[List[str]]


BRAINTRUST_PARAMS = ["use_cache"]
