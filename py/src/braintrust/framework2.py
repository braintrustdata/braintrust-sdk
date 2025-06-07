import dataclasses
import json
from typing import Any, Callable, Dict, List, Optional, Union, overload

import slugify

from braintrust.logger import api_conn, app_conn, login

from .framework import _is_lazy_load, bcolors  # type: ignore
from .types import (
    ChatCompletionMessageParam,
    IfExists,
    ModelParams,
    PromptData,
    PromptOptions,
    SavedFunctionId,
    ToolFunctionDefinition,
)
from .util import eprint


class ProjectIdCache:
    def __init__(self):
        self._cache: Dict[Project, str] = {}

    def get(self, project: "Project") -> str:
        if project not in self._cache:
            resp = app_conn().post_json("api/project/register", {"project_name": project.name})
            self._cache[project] = resp["project"]["id"]
        return self._cache[project]


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
    function_type: Optional[str]
    id: Optional[str]
    if_exists: Optional[IfExists]

    def to_function_definition(self, if_exists: Optional[IfExists], project_ids: ProjectIdCache) -> Dict[str, Any]:
        prompt_data = self.prompt
        if len(self.tool_functions) > 0:
            resolvable_tool_functions: List[Any] = []
            for f in self.tool_functions:
                if isinstance(f, CodeFunction):
                    resolvable_tool_functions.append(
                        {
                            "type": "slug",
                            "project_id": project_ids.get(f.project),
                            "slug": f.slug,
                        }
                    )
                else:
                    resolvable_tool_functions.append(f)
            prompt_data["tool_functions"] = resolvable_tool_functions
        j: Dict[str, Any] = {
            "project_id": project_ids.get(self.project),
            "name": self.name,
            "slug": self.slug,
            "function_data": {
                "type": "prompt",
            },
            "prompt_data": prompt_data,
            "if_exists": self.if_exists if self.if_exists is not None else if_exists,
        }
        if self.description is not None:
            j["description"] = self.description
        if self.function_type is not None:
            j["function_type"] = self.function_type

        return j


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
        """Creates a tool.

        Args:
            handler: The function that is called when the tool is used.
            name: The name of the tool.
            slug: A unique identifier for the tool.
            description: The description of the tool.
            parameters: The tool's input schema, as a Pydantic model.
            returns: The tool's output schema, as a Pydantic model.
            if_exists: What to do if the tool already exists.

        Returns:
            A handle to the created tool, that can be used in a prompt.
        """
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
        self.project.add_code_function(f)
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
    ) -> CodePrompt:
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
    ) -> CodePrompt:
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
        """Creates a prompt.

        Args:
            name: The name of the prompt.
            slug: A unique identifier for the prompt.
            description: The description of the prompt.
            id: The ID of the prompt.
            prompt: The prompt text. Exactly one of prompt or messages must be provided.
            messages: The messages to send to the model. Exactly one of prompt or messages must be provided.
            model: The model to use for the prompt.
            params: The model parameters to use for the prompt.
            tools: The tools to use for the prompt.
            if_exists: What to do if the prompt already exists.
        """
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
            function_type=None,
            id=id,
            if_exists=if_exists,
        )
        self.project.add_prompt(p)
        return p


class ScorerBuilder:
    """Builder to create a scorer in Braintrust."""

    def __init__(self, project: "Project"):
        self.project = project
        self._task_counter = 0

    # Code scorer.
    @overload
    def create(
        self,
        *,
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        if_exists: Optional[IfExists] = None,
        handler: Callable[..., Any],
        parameters: Any,
        returns: Any = None,
    ) -> CodeFunction:
        ...

    # LLM scorer with prompt.
    @overload
    def create(
        self,
        *,
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        if_exists: Optional[IfExists] = None,
        prompt: str,
        model: str,
        params: Optional[ModelParams] = None,
        use_cot: bool,
        choice_scores: Dict[str, float],
    ) -> CodePrompt:
        ...

    # LLM scorer with messages.
    @overload
    def create(
        self,
        *,
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        if_exists: Optional[IfExists] = None,
        messages: List[ChatCompletionMessageParam],
        model: str,
        params: Optional[ModelParams] = None,
        use_cot: bool,
        choice_scores: Dict[str, float],
    ) -> CodePrompt:
        ...

    def create(
        self,
        *,
        name: Optional[str] = None,
        slug: Optional[str] = None,
        description: Optional[str] = None,
        if_exists: Optional[IfExists] = None,
        # Code scorer params.
        handler: Optional[Callable[..., Any]] = None,
        parameters: Any = None,
        returns: Any = None,
        # LLM scorer params.
        prompt: Optional[str] = None,
        messages: Optional[List[ChatCompletionMessageParam]] = None,
        model: Optional[str] = None,
        params: Optional[ModelParams] = None,
        use_cot: Optional[bool] = None,
        choice_scores: Optional[Dict[str, float]] = None,
    ) -> Union[CodeFunction, CodePrompt]:
        """Creates a scorer.

        Args:
            name: The name of the scorer.
            slug: A unique identifier for the scorer.
            description: The description of the scorer.
            if_exists: What to do if the scorer already exists.

            The remaining args are mutually exclusive; that is,
            the function will only accept args from one of the following overloads.

            Code scorer:
            handler: The function that is called when the scorer is used. Required.
            parameters: The scorer's input schema, as a Pydantic model. Required.
            returns: The scorer's output schema, as a Pydantic model.

            LLM scorer:
            prompt: The prompt to use for the scorer. Either prompt or messages is required.
            messages: The messages to use for the scorer. Either prompt or messages is required.
            model: The model to use for the scorer. Required.
            params: The model parameters to use for the scorer.
            use_cot: Whether to use chain-of-thought for the scorer. Required.
            choice_scores: The scores for each choice. Required.
        """
        self._task_counter += 1
        if name is None or len(name) == 0:
            if handler and handler.__name__ and handler.__name__ != "<lambda>":
                name = handler.__name__
            else:
                name = f"Scorer {self._task_counter}"
        if slug is None or len(slug) == 0:
            slug = slugify.slugify(name)

        if handler is not None:  # code scorer
            assert parameters is not None
            f = CodeFunction(
                project=self.project,
                handler=handler,
                name=name,
                slug=slug,
                type_="scorer",
                description=description,
                parameters=parameters,
                returns=returns,
                if_exists=if_exists,
            )
            self.project.add_code_function(f)
            return f
        else:  # LLM scorer
            assert model is not None
            assert use_cot is not None
            assert choice_scores is not None
            prompt_data: PromptData = {}
            if messages is not None:
                assert prompt is None
                prompt_data["prompt"] = {
                    "type": "chat",
                    "messages": messages,
                }
            else:
                assert prompt is not None
                prompt_data["prompt"] = {
                    "type": "completion",
                    "content": prompt,
                }
            prompt_data["options"] = {"model": model}
            if params is not None:
                prompt_data["options"]["params"] = params
            prompt_data["parser"] = {
                "type": "llm_classifier",
                "use_cot": use_cot,
                "choice_scores": choice_scores,
            }
            p = CodePrompt(
                project=self.project,
                name=name,
                slug=slug,
                prompt=prompt_data,
                tool_functions=[],
                description=description,
                function_type="scorer",
                id=None,
                if_exists=if_exists,
            )
            self.project.add_prompt(p)
            return p


class Project:
    """A handle to a Braintrust project."""

    def __init__(self, name: str):
        self.name = name
        self.tools = ToolBuilder(self)
        self.prompts = PromptBuilder(self)
        self.scorers = ScorerBuilder(self)

        self._publishable_code_functions: List[CodeFunction] = []
        self._publishable_prompts: List[CodePrompt] = []

    def add_code_function(self, fn: CodeFunction):
        self._publishable_code_functions.append(fn)
        if _is_lazy_load():
            global_.functions.append(fn)

    def add_prompt(self, prompt: CodePrompt):
        self._publishable_prompts.append(prompt)
        if _is_lazy_load():
            global_.prompts.append(prompt)

    def publish(self):
        if _is_lazy_load():
            eprint(f"{bcolors.WARNING}publish() is a no-op when running `braintrust push`.{bcolors.ENDC}")
            return

        login()
        project_id_cache = ProjectIdCache()

        definitions: List[Dict[str, Any]] = []
        if self._publishable_code_functions:
            eprint(
                f"{bcolors.WARNING}Code functions cannot be published directly. Use `braintrust push` instead.{bcolors.ENDC}"
            )

        for prompt in self._publishable_prompts:
            prompt_definition = prompt.to_function_definition(None, project_id_cache)
            definitions.append(prompt_definition)
        return api_conn().post_json("insert-functions", {"functions": definitions})


class ProjectBuilder:
    """Creates handles to Braintrust projects."""

    def create(self, name: str) -> Project:
        return Project(name)


projects = ProjectBuilder()
