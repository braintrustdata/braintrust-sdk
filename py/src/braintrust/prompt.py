from dataclasses import dataclass
from typing import List, Literal, Optional, Union

from braintrust_core.serializable_data_class import SerializableDataClass

from .types import PromptOptions

# Keep these definitions in sync with sdk/core/js/typespecs/prompt.ts.


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
class TextPart(SerializableDataClass):
    text: str
    type: Literal["text"] = "text"


@dataclass
class ImageURL(SerializableDataClass):
    url: str
    detail: Literal["auto", "low", "high"] = "auto"


@dataclass
class ImagePart(SerializableDataClass):
    image_url: ImageURL
    type: Literal["image_url"] = "image_url"


@dataclass
class PromptMessage(SerializableDataClass):
    content: Union[str, List[Union[TextPart, ImagePart]]]
    role: Literal["system", "user", "assistant", "function", "tool", "model"]
    name: Optional[str] = None
    function_call: Union[str, FunctionCall, None] = None
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
    options: Optional[PromptOptions] = None


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
