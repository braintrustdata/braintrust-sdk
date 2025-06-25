import importlib
import os
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Dict, List, Literal, Optional, TypedDict, Union

from pydantic import BaseModel

from braintrust.framework import Evaluator, Filter, ReporterDef, _evals, _set_lazy_load
from braintrust.prompt import PromptData
from braintrust.span_identifier_v2 import SpanRowIdsV2
from braintrust.span_identifier_v3 import SpanObjectTypeV3

_import_lock = Lock()


@dataclass
class FileHandle:
    in_file: str

    def rebuild(self):
        in_file = os.path.abspath(self.in_file)

        with _import_lock:
            with _set_lazy_load(True):
                _evals.clear()

                try:
                    # https://stackoverflow.com/questions/67631/how-can-i-import-a-module-dynamically-given-the-full-path
                    spec = importlib.util.spec_from_file_location("eval", in_file)
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)

                    ret = _evals.copy()
                finally:
                    _evals.clear()

        return ret

    def watch(self):
        raise NotImplementedError


@dataclass
class EvaluatorOpts:
    verbose: bool
    no_send_logs: bool
    no_progress_bars: bool
    terminate_on_failure: bool
    watch: bool
    filters: List[Filter]
    list: bool
    jsonl: bool


@dataclass
class LoadedEvaluator:
    handle: FileHandle
    evaluator: Evaluator[Any, Any]
    reporter: Optional[Union[ReporterDef[Any, Any, Any], str]] = None


@dataclass
class EvaluatorState:
    evaluators: List[LoadedEvaluator] = field(default_factory=list)
    reporters: Dict[str, ReporterDef[Any, Any, Any]] = field(default_factory=dict)


class InvokeParent(BaseModel):
    object_type: SpanObjectTypeV3
    object_id: Optional[str] = None
    row_ids: Optional[SpanRowIdsV2] = None
    propagated_event: Optional[Dict[str, Any]] = None


class FunctionId(BaseModel):
    function_id: str
    version: Optional[str] = None


class ProjectNameSlug(BaseModel):
    project_name: str
    slug: str
    version: Optional[str] = None


class GlobalFunction(BaseModel):
    global_function: str


class PromptSessionId(BaseModel):
    prompt_session_id: str
    prompt_session_function_id: str
    version: Optional[str] = None


class RuntimeContext(BaseModel):
    runtime: Union[Literal["node"], Literal["python"]]
    version: str


class InlineCodeFunction(BaseModel):
    inline_context: RuntimeContext
    code: str
    name: Optional[str] = None


class InlineFunctionDef(BaseModel):
    inline_prompt: PromptData
    inline_function: Dict[str, Any]
    name: Optional[str] = None


class InlinePrompt(BaseModel):
    inline_prompt: PromptData
    name: Optional[str] = None


class Score(BaseModel):
    function_id: Union[
        FunctionId,
        ProjectNameSlug,
        GlobalFunction,
        PromptSessionId,
        InlineCodeFunction,
        InlineFunctionDef,
        InlinePrompt,
    ]
    name: str


class EvalParametersPrompt(TypedDict):
    type: Literal["prompt"]
    default: Optional[PromptData]
    description: Optional[str]


class EvalParametersData(TypedDict):
    type: Literal["data"]
    schema: dict[str, Any]
    default: Optional[Any]
    description: Optional[str]


EvalParameters = dict[str, Union[EvalParametersPrompt, EvalParametersData]]


class ListEvalsScore(TypedDict):
    name: str


class ListEvals(BaseModel):
    parameters: Optional[EvalParameters]
    scores: list[ListEvalsScore]


class DatasetId(BaseModel):
    dataset_id: str
    _internal_btql: Optional[Dict[str, Any]] = None


class ProjectAndDataset(BaseModel):
    project_name: str
    dataset_name: str
    _internal_btql: Optional[Dict[str, Any]] = None


class DatasetRows(BaseModel):
    data: List[Any]


RunEvalData = Union[DatasetId, ProjectAndDataset, DatasetRows]


class EvalRequest(BaseModel):
    name: str
    parameters: Optional[EvalParameters] = None
    data: RunEvalData
    parent: Optional[InvokeParent] = None
    scores: Optional[List[Score]] = None
    stream: Optional[bool] = False
