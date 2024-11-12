import dataclasses
import json
from typing import Any, Callable, List, Optional, Union

import slugify


class _GlobalState:
    def __init__(self):
        self.functions = []
        self.prompts = []


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
    parameters: Optional[Any]
    returns: Optional[Any]
    if_exists: Optional[str]


@dataclasses.dataclass
class CodePrompt:
    """A prompt defined in code, with metadata."""

    project: "Project"
    name: str
    slug: str
    prompt: Any
    tool_functions: List[Union[CodeFunction, Any]]
    description: Optional[str]
    id: Optional[str]
    if_exists: Optional[str]


class ToolBuilder:
    """Builder to create a tool in Braintrust."""

    def __init__(self, project: "Project"):
        self.project = project
        self._task_counter = 0

    def create(
        self,
        *,
        handler: Any,
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        parameters: Optional[Any] = None,
        returns: Optional[Any] = None,
        if_exists: Optional[str] = None,
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

    def create(
        self,
        *,
        model: str,
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        id: Optional[str] = None,
        prompt: Optional[str] = None,
        messages: Optional[List[Any]] = None,
        params: Optional[Any] = None,
        tools: Optional[List[Union[CodeFunction, Any]]] = None,
        if_exists: Optional[str] = None,
    ):
        """Creates a prompt."""
        self._task_counter += 1
        if not name:
            name = f"Prompt {self._task_counter}"
        if not slug:
            slug = slugify.slugify(name)

        tool_functions = []
        raw_tools = []
        for tool in tools or []:
            if isinstance(tool, CodeFunction):
                tool_functions.append(tool)
            elif "type" in tool and "function" not in tool:
                tool_functions.append(tool)
            else:
                raw_tools.append(tool)

        if messages is not None:
            prompt_block = {
                "type": "chat",
                "messages": messages,
            }
            if len(raw_tools) > 0:
                prompt_block["tools"] = json.dumps(raw_tools)
        else:
            prompt_block = {
                "type": "completion",
                "content": prompt,
            }
        options = {"model": model}
        if params is not None:
            options["params"] = params
        prompt_data = {"prompt": prompt_block, "options": options}

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
