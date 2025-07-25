"""Re-exports generated typespecs that are considered public API."""

from dataclasses import dataclass
from typing import List, Optional, Union

from braintrust.serializable_data_class import SerializableDataClass

from ._types import (
    AttachmentReference,  # noqa: F401 # type: ignore[reportUnusedImport]
    AttachmentStatus,  # noqa: F401 # type: ignore[reportUnusedImport]
    ChatCompletionMessageParam,  # noqa: F401 # type: ignore[reportUnusedImport]
    DatasetEvent,  # noqa: F401 # type: ignore[reportUnusedImport]
    ExperimentEvent,  # noqa: F401 # type: ignore[reportUnusedImport]
    IfExists,  # noqa: F401 # type: ignore[reportUnusedImport]
    ModelParams,  # noqa: F401 # type: ignore[reportUnusedImport]
    PromptData,  # noqa: F401 # type: ignore[reportUnusedImport]
    PromptOptions,  # noqa: F401 # type: ignore[reportUnusedImport]
    SavedFunctionId,  # noqa: F401 # type: ignore[reportUnusedImport]
    SpanAttributes,  # noqa: F401 # type: ignore[reportUnusedImport]
    SpanType,  # noqa: F401 # type: ignore[reportUnusedImport]
    ToolFunctionDefinition,  # noqa: F401 # type: ignore[reportUnusedImport]
)


@dataclass
class PromptContentsPromptAndParamsAndTools(SerializableDataClass):
    prompt: str
    model: Optional[str] = None
    params: Optional[ModelParams] = None
    tools: Optional[List[ToolFunctionDefinition]] = None


@dataclass
class PromptContentsMessagesAndParamsAndTools(SerializableDataClass):
    messages: List[ChatCompletionMessageParam]
    model: Optional[str] = None
    params: Optional[ModelParams] = None
    tools: Optional[List[ToolFunctionDefinition]] = None


PromptDefinitionWithTools = Union[PromptContentsPromptAndParamsAndTools, PromptContentsMessagesAndParamsAndTools]
