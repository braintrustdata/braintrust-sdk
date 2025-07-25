import json
from dataclasses import dataclass
from typing import List, Literal, Optional, Union

from .serializable_data_class import SerializableDataClass
from .types import ChatCompletionMessageParam, ModelParams, PromptOptions, ToolFunctionDefinition

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


def prompt_definition_to_prompt_data(
    prompt: Optional[str] = None,
    messages: Optional[List[ChatCompletionMessageParam]] = None,
    model: Optional[str] = None,
    params: Optional[ModelParams] = None,
    tools: Optional[List[ToolFunctionDefinition]] = None,
):
    prompt_data = {}
    if messages is not None:
        prompt_data["prompt"] = {
            "type": "chat",
            "messages": messages,
        }
        if tools and len(tools) > 0:
            prompt_data["prompt"]["tools"] = json.dumps(tools)
    else:
        assert prompt is not None
        prompt_data["prompt"] = {
            "type": "completion",
            "content": prompt,
        }

    options: PromptOptions = {"model": model}
    if params is not None:
        options["params"] = params
    prompt_data["options"] = options

    return PromptData.from_dict(prompt_data)
