import dataclasses
import json
from typing import Any, Callable, List, Optional, Union, overload

import slugify

from .types import (
    ChatCompletionMessageParam,
    IfExists,
    ModelParams,
    PromptData,
    PromptOptions,
    SavedFunctionId,
    ToolFunctionDefinition,
)


class _GlobalState:
    def __init__(self):
        self.functions: List[CodeFunction] = []
        self.prompts: List[CodePrompt] = []


global_ = _GlobalState()


@dataclasses.dataclass
class CodeFunction:
    """A generic callable, with metadata."""

    project: "Project"
    handler: Callable[..., Any]
    name: str
    slug: str
    type_: str
    description: Optional[str]
    parameters: Any
    returns: Any
    if_exists: Optional[IfExists]


@dataclasses.dataclass
class CodePrompt:
    """A prompt defined in code, with metadata."""

    project: "Project"
    name: str
    slug: str
    prompt: PromptData
    tool_functions: List[Union[CodeFunction, SavedFunctionId]]
    description: Optional[str]
    id: Optional[str]
    if_exists: Optional[IfExists]


class ToolBuilder:
    """Builder to create a tool in Braintrust."""

    def __init__(self, project: "Project"):
        self.project = project
        self._task_counter = 0

    def create(
        self,
        *,
        handler: Callable[..., Any],
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        parameters: Any = None,
        returns: Any = None,
        if_exists: Optional[IfExists] = None,
    ) -> CodeFunction:
        """Creates a tool from handler."""
        self._task_counter += 1
        if not name:
            if handler.__name__ and handler.__name__ != "<lambda>":
                name = handler.__name__
            else:
                name = f"Tool {self._task_counter}"
        assert name is not None
        if not slug:
            slug = slugify.slugify(name)
        f = CodeFunction(
            project=self.project,
            handler=handler,
            name=name,
            slug=slug,
            type_="tool",
            description=description,
            parameters=parameters,
            returns=returns,
            if_exists=if_exists,
        )
        global_.functions.append(f)
        return f


class PromptBuilder:
    """Builder to create a prompt in Braintrust."""

    def __init__(self, project: "Project"):
        self.project = project
        self._task_counter = 0

    @overload  # prompt only, no messages
    def create(
        self,
        *,
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        id: Optional[str] = None,
        prompt: str,
        model: str,
        params: Optional[ModelParams] = None,
        tools: Optional[List[Union[CodeFunction, SavedFunctionId, ToolFunctionDefinition]]] = None,
        if_exists: Optional[IfExists] = None,
    ):
        ...

    @overload  # messages only, no prompt
    def create(
        self,
        *,
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        id: Optional[str] = None,
        messages: List[ChatCompletionMessageParam],
        model: str,
        params: Optional[ModelParams] = None,
        tools: Optional[List[Union[CodeFunction, SavedFunctionId, ToolFunctionDefinition]]] = None,
        if_exists: Optional[IfExists] = None,
    ):
        ...

    def create(
        self,
        *,
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        id: Optional[str] = None,
        prompt: Optional[str] = None,
        messages: Optional[List[ChatCompletionMessageParam]] = None,
        model: str,
        params: Optional[ModelParams] = None,
        tools: Optional[List[Union[CodeFunction, SavedFunctionId, ToolFunctionDefinition]]] = None,
        if_exists: Optional[IfExists] = None,
    ):
        """Creates a prompt."""
        self._task_counter += 1
        if not name:
            name = f"Prompt {self._task_counter}"
        if not slug:
            slug = slugify.slugify(name)

        tool_functions: List[Union[CodeFunction, SavedFunctionId]] = []
        raw_tools: List[ToolFunctionDefinition] = []
        for tool in tools or []:
            if isinstance(tool, CodeFunction):
                tool_functions.append(tool)
            elif "type" in tool and "function" not in tool:
                # SavedFunctionId
                tool_functions.append(tool)
            else:
                # ToolFunctionDefinition
                raw_tools.append(tool)

        prompt_data: PromptData = {}
        if messages is not None:
            prompt_data["prompt"] = {
                "type": "chat",
                "messages": messages,
            }
            if len(raw_tools) > 0:
                prompt_data["prompt"]["tools"] = json.dumps(raw_tools)
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

        p = CodePrompt(
            project=self.project,
            name=name,
            slug=slug,
            prompt=prompt_data,
            tool_functions=tool_functions,
            description=description,
            id=id,
            if_exists=if_exists,
        )
        global_.prompts.append(p)
        return p


class Project:
    """A handle to a Braintrust project."""

    def __init__(self, name: str):
        self.name = name
        self.tools = ToolBuilder(self)
        self.prompts = PromptBuilder(self)


class ProjectBuilder:
    """Creates handles to Braintrust projects."""

    def create(self, name: str) -> Project:
        return Project(name)


projects = ProjectBuilder()
