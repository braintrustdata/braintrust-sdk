from dataclasses import dataclass
from typing import Literal, Union

from .generated_types import PromptOptions
from .serializable_data_class import SerializableDataClass

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
    content: str | list[TextPart | ImagePart]
    role: Literal["system", "user", "assistant", "function", "tool", "model"]
    name: str | None = None
    function_call: str | FunctionCall | None = None
    tool_calls: list[ToolCall] | None = None


@dataclass
class PromptChatBlock(SerializableDataClass):
    messages: list[PromptMessage]
    tools: str | None = None
    type: Literal["chat"] = "chat"


PromptBlockData = Union[PromptCompletionBlock, PromptChatBlock]


TemplateFormat = Literal["mustache", "jinja", "none"]


@dataclass
class PromptData(SerializableDataClass):
    prompt: PromptBlockData | None = None
    options: PromptOptions | None = None
    template_format: TemplateFormat | None = None

    @classmethod
    def from_dict_deep(cls, d: dict):
        d2 = dict(d)
        if d2.get("template_format") == "nunjucks":
            d2["template_format"] = "jinja"
        return super().from_dict_deep(d2)


@dataclass
class PromptSchema(SerializableDataClass):
    id: str | None
    project_id: str | None
    _xact_id: str | None
    name: str
    slug: str
    description: str | None
    prompt_data: PromptData
    tags: list[str] | None


BRAINTRUST_PARAMS = ["use_cache"]
