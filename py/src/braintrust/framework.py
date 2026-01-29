import abc
import asyncio
import contextvars
import dataclasses
import inspect
import json
import re
import sys
import traceback
import warnings
from collections import defaultdict
from collections.abc import Awaitable, Callable, Coroutine, Iterable, Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from multiprocessing import cpu_count
from typing import (
    Any,
    Generic,
    Literal,
    Optional,
    TypeVar,
    Union,
)

from tqdm.asyncio import tqdm as async_tqdm
from tqdm.auto import tqdm as std_tqdm
from typing_extensions import NotRequired, Protocol, TypedDict

from .generated_types import FunctionFormat, FunctionOutputType, ObjectReference
from .git_fields import GitMetadataSettings, RepoInfo
from .logger import (
    BraintrustState,
    Dataset,
    Experiment,
    ExperimentSummary,
    Metadata,
    ScoreSummary,
    Span,
    _ExperimentDatasetEvent,
    parent_context,
    start_span,
    stringify_exception,
)
from .logger import init as _init_experiment
from .parameters import EvalParameters
from .resource_manager import ResourceManager
from .score import Score, is_score, is_scorer
from .serializable_data_class import SerializableDataClass
from .span_types import SpanTypeAttribute
from .util import bt_iscoroutinefunction, eprint, merge_dicts

Input = TypeVar("Input")
Output = TypeVar("Output")


# https://stackoverflow.com/questions/287871/how-do-i-print-colored-text-to-the-terminal
class bcolors:
    HEADER = "\033[95m"
    OKBLUE = "\033[94m"
    OKCYAN = "\033[96m"
    OKGREEN = "\033[92m"
    WARNING = "\033[93m"
    FAIL = "\033[91m"
    ENDC = "\033[0m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"


@dataclasses.dataclass
class EvalCase(SerializableDataClass, Generic[Input, Output]):
    """
    An evaluation case. This is a single input to the evaluation task, along with an optional expected
    output, metadata, and tags.
    """

    input: Input
    expected: Output | None = None
    metadata: Metadata | None = None
    tags: Sequence[str] | None = None

    # These fields are only set if the EvalCase is part of a Dataset.
    id: str | None = None
    _xact_id: str | None = None
    created: str | None = None


class _EvalCaseDictNoOutput(Generic[Input], TypedDict):
    """
    Workaround for the Pyright type checker handling of generics. Specifically,
    the type checker doesn't know that a dict which is missing the key
    "expected" can be used to satisfy `_EvalCaseDict[Input, Output]` for any
    `Output` type.
    """

    input: Input
    metadata: NotRequired[Metadata | None]
    tags: NotRequired[Sequence[str] | None]

    id: NotRequired[str | None]
    _xact_id: NotRequired[str | None]


class _EvalCaseDict(Generic[Input, Output], _EvalCaseDictNoOutput[Input]):
    """
    Mirrors EvalCase for callers who pass a dict instead of dataclass.
    """

    expected: NotRequired[Output | None]


# Inheritance doesn't quite work for dataclasses, so we redefine the fields
# from EvalCase here.
@dataclasses.dataclass
class EvalResult(SerializableDataClass, Generic[Input, Output]):
    """The result of an evaluation. This includes the input, expected output, actual output, and metadata."""

    input: Input
    output: Output
    scores: dict[str, float | None]
    expected: Output | None = None
    metadata: Metadata | None = None
    tags: list[str] | None = None
    error: Exception | None = None
    exc_info: str | None = None


@dataclasses.dataclass
class TaskProgressEvent(TypedDict):
    """Progress event that can be reported during task execution."""

    format: FunctionFormat
    output_type: FunctionOutputType
    event: Literal[
        "reasoning_delta",
        "text_delta",
        "json_delta",
        "error",
        "console",
        "start",
        "done",
        "progress",
    ]
    data: str


class SSEProgressEvent(TaskProgressEvent):
    """
    A progress event that can be reported during task execution, specifically for SSE (Server-Sent Events) streams.
    This is a subclass of TaskProgressEvent with additional fields for SSE-specific metadata.
    """

    id: str
    object_type: str
    origin: ObjectReference
    name: str


class EvalHooks(abc.ABC, Generic[Output]):
    """
    An object that can be used to add metadata to an evaluation. This is passed to the `task` function.
    """

    @property
    @abc.abstractmethod
    def metadata(self) -> Metadata:
        """
        The metadata object for the current evaluation. You can mutate this object to add or remove metadata.
        """

    @property
    @abc.abstractmethod
    def expected(self) -> Output | None:
        """
        The expected output for the current evaluation.
        """

    @property
    @abc.abstractmethod
    def span(self) -> Span:
        """
        Access the span under which the task is run. Also accessible via braintrust.current_span()
        """

    @property
    @abc.abstractmethod
    def trial_index(self) -> int:
        """
        The index of the current trial (0-based). This is useful when trial_count > 1.
        """

    @property
    @abc.abstractmethod
    def tags(self) -> Sequence[str]:
        """
        The tags for the current evaluation. You can mutate this object to add or remove tags.
        """

    @abc.abstractmethod
    def report_progress(self, progress: TaskProgressEvent) -> None:
        """
        Report progress that will show up in the playground.
        """
        ...

    @abc.abstractmethod
    def meta(self, **info: Any) -> None:
        """
        DEPRECATED: Use the metadata field on the hook directly.

        Adds metadata to the evaluation. This metadata will be logged to the Braintrust. You can pass in metadaa
        as keyword arguments, e.g. `hooks.meta(foo="bar")`.
        """
        ...

    @property
    @abc.abstractmethod
    def parameters(self) -> dict[str, Any] | None:
        """
        The parameters for the current evaluation. These are the validated parameter values
        that were passed to the evaluator.
        """


class EvalScorerArgs(SerializableDataClass, Generic[Input, Output]):
    """
    Arguments passed to an evaluator scorer. This includes the input, expected output, actual output, and metadata.
    """

    input: Input
    output: Output
    expected: Output | None = None
    metadata: Metadata | None = None


OneOrMoreScores = Union[float, int, bool, None, Score, list[Score]]


# Synchronous scorer interface - implements callable
class SyncScorerLike(Protocol, Generic[Input, Output]):
    """
    Protocol for synchronous scorers that implement the callable interface.
    This is the most common interface and is used when no async version is available.
    """

    def __call__(
        self, input: Input, output: Output, expected: Output | None = None, **kwargs: Any
    ) -> OneOrMoreScores: ...


# Asynchronous scorer interface
class AsyncScorerLike(Protocol, Generic[Input, Output]):
    """
    Protocol for asynchronous scorers that implement the eval_async interface.
    The framework will prefer this interface if available.
    """

    async def eval_async(self, output: Output, expected: Output | None = None, **kwargs: Any) -> OneOrMoreScores: ...


# Union type for any kind of scorer (for typing)
ScorerLike = Union[SyncScorerLike[Input, Output], AsyncScorerLike[Input, Output]]

EvalScorer = Union[
    ScorerLike[Input, Output],
    type[ScorerLike[Input, Output]],
    Callable[[Input, Output, Output], OneOrMoreScores],
    Callable[[Input, Output, Output], Awaitable[OneOrMoreScores]],
]


@dataclasses.dataclass
class BaseExperiment:
    """
    Use this to specify that the dataset should actually be the data from a previous (base) experiment.
    If you do not specify a name, Braintrust will automatically figure out the best base experiment to
    use based on your git history (or fall back to timestamps).
    """

    name: str | None = None
    """
    The name of the base experiment to use. If unspecified, Braintrust will automatically figure out the best base
    using your git history (or fall back to timestamps).
    """


_AnyEvalCase = Union[
    EvalCase[Input, Output],
    _EvalCaseDict[Input, Output],
    _EvalCaseDictNoOutput[Input],
    _ExperimentDatasetEvent,
]

_EvalDataObject = Union[
    Iterable[_AnyEvalCase[Input, Output]],
    Iterator[_AnyEvalCase[Input, Output]],
    Awaitable[Iterator[_AnyEvalCase[Input, Output]]],
    Callable[[], Union[Iterator[_AnyEvalCase[Input, Output]], Awaitable[Iterator[_AnyEvalCase[Input, Output]]]]],
    BaseExperiment,
]

EvalData = Union[_EvalDataObject[Input, Output], type[_EvalDataObject[Input, Output]], Dataset]

EvalTask = Union[
    Callable[[Input], Union[Output, Awaitable[Output]]],
    Callable[[Input, EvalHooks[Output]], Union[Output, Awaitable[Output]]],
]

ErrorScoreHandler = Callable[[Span, EvalCase[Input, Output], list[str]], Optional[dict[str, float]]]


@dataclasses.dataclass
class Evaluator(Generic[Input, Output]):
    """
    An evaluator is an abstraction that defines an evaluation dataset, a task to run on the dataset, and a set of
    scorers to evaluate the results of the task. Each method attribute can be synchronous or asynchronous (for
    optimal performance, it is recommended to provide asynchronous implementations).

    You should not create Evaluators directly if you plan to use the Braintrust eval framework. Instead, you should
    create them using the `Eval()` method, which will register them so that `braintrust eval ...` can find them.
    """

    project_name: str
    """
    The name of the project the eval falls under.
    """

    eval_name: str
    """
    A name that describes the experiment. You do not need to change it each time the experiment runs.
    """

    data: EvalData[Input, Output]
    """
    Returns an iterator over the evaluation dataset. Each element of the iterator should be an `EvalCase` or a dict
    with the same fields as an `EvalCase` (`input`, `expected`, `metadata`).
    """

    task: EvalTask[Input, Output]
    """
    Runs the evaluation task on a single input. The `hooks` object can be used to add metadata to the evaluation.
    """

    scores: list[EvalScorer[Input, Output]]
    """
    A list of scorers to evaluate the results of the task. Each scorer can be a Scorer object or a function
    that takes `input`, `output`, and `expected` arguments and returns a `Score` object. The function can be async.
    """

    experiment_name: str | None
    """
    Optional experiment name. If not specified, a name will be generated automatically.
    """

    metadata: Metadata | None
    """
    A dictionary with additional data about the test example, model outputs, or just about anything else that's
    relevant, that you can use to help find and analyze examples later. For example, you could log the `prompt`,
    example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata` can be any
    JSON-serializable type, but its keys must be strings.
    """

    trial_count: int = 1
    """
    The number of times to run the evaluator per input. This is useful for evaluating applications that
    have non-deterministic behavior and gives you both a stronger aggregate measure and a sense of the
    variance in the results.
    """

    is_public: bool = False
    """
    Whether the experiment should be public. Defaults to false.
    """

    update: bool = False
    """
    Whether to update an existing experiment with `experiment_name` if one exists. Defaults to false.
    """

    timeout: float | None = None
    """
    The duration, in seconds, after which to time out the evaluation.
    Defaults to None, in which case there is no timeout.
    """

    max_concurrency: int | None = None
    """
    The maximum number of tasks/scorers that will be run concurrently.
    Defaults to None, in which case there is no max concurrency.
    """

    project_id: str | None = None
    """
    If specified, uses the given project ID instead of the evaluator's name to identify the project.
    """

    base_experiment_name: str | None = None
    """
    An optional experiment name to use as a base. If specified, the new experiment will be summarized and
    compared to this experiment.
    """

    base_experiment_id: str | None = None
    """
    An optional experiment id to use as a base. If specified, the new experiment will be summarized and
    compared to this experiment. This takes precedence over `base_experiment_name` if specified.
    """

    git_metadata_settings: GitMetadataSettings | None = None
    """
    Optional settings for collecting git metadata. By default, will collect all
    git metadata fields allowed in org-level settings.
    """

    repo_info: RepoInfo | None = None
    """
    Optionally explicitly specify the git metadata for this experiment. This
    takes precedence over `git_metadata_settings` if specified.
    """

    error_score_handler: ErrorScoreHandler | None = None
    """
    Optionally supply a custom function to specifically handle score values when tasks or scoring functions have errored.
    A default implementation is exported as `default_error_score_handler` which will log a 0 score to the root span for any scorer that was not run.
    """

    description: str | None = None
    """
    An optional description for the experiment.
    """

    summarize_scores: bool = True
    """
    Whether to summarize the scores of the experiment after it has run.
    """

    parameters: EvalParameters | None = None
    """
    A set of parameters that will be passed to the evaluator.
    Can be used to define prompts or other configurable values.
    """


@dataclasses.dataclass
class EvalResultWithSummary(SerializableDataClass, Generic[Input, Output]):
    summary: ExperimentSummary
    results: list[EvalResult[Input, Output]]

    def _repr_pretty_(self, p, cycle):
        p.text(f'EvalResultWithSummary(summary="...", results=[...])')


EvalReport = TypeVar("EvalReport")


async def await_or_run(event_loop, f, *args, **kwargs):
    if bt_iscoroutinefunction(f):
        return await f(*args, **kwargs)
    else:

        def run_f(args, kwargs, ctx):
            tokens = [(var, var.set(value)) for var, value in ctx.items()]
            try:
                return f(*args, **kwargs)
            finally:
                for var, tok in tokens:
                    var.reset(tok)

        with _THREAD_POOL_SINGLETON.get() as thread_pool:
            return await event_loop.run_in_executor(
                thread_pool.thread_pool(), run_f, args, kwargs, contextvars.copy_context()
            )


def _call_user_fn_args(fn, kwargs):
    try:
        signature = inspect.signature(fn)
    except:
        return [], kwargs

    accepts_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values())

    positional_args = []
    final_kwargs = {}

    for name, param in signature.parameters.items():
        # VAR_POSITIONAL is *args
        # VAR_KEYWORD is **kwargs
        # We don't want to use eithers' name
        if param.kind == inspect.Parameter.VAR_POSITIONAL or param.kind == inspect.Parameter.VAR_KEYWORD:
            continue

        if name in kwargs:
            final_kwargs[name] = kwargs.pop(name)
        else:
            next_arg = list(kwargs.keys())[0]
            final_kwargs[name] = kwargs.pop(next_arg)

    if accepts_kwargs:
        final_kwargs.update(kwargs)

    return positional_args, final_kwargs


async def call_user_fn(event_loop, fn, **kwargs):
    positional_args, final_kwargs = _call_user_fn_args(fn, kwargs)
    return await await_or_run(event_loop, fn, *positional_args, **final_kwargs)


@dataclasses.dataclass
class ReporterDef(SerializableDataClass, Generic[Input, Output, EvalReport]):
    """
    A reporter takes an evaluator and its result and returns a report.
    """

    name: str
    """
    The name of the reporter.
    """

    report_eval: Callable[
        [Evaluator[Input, Output], EvalResultWithSummary[Input, Output], bool, bool],
        EvalReport | Awaitable[EvalReport],
    ]
    """
    A function that takes an evaluator and its result and returns a report.
    """

    report_run: Callable[[list[EvalReport], bool, bool], bool | Awaitable[bool]]
    """
    A function that takes all evaluator results and returns a boolean indicating whether the run was successful.
    If you return false, the `braintrust eval` command will exit with a non-zero status code.
    """

    async def _call_report_eval(
        self,
        evaluator: Evaluator[Input, Output],
        result: EvalResultWithSummary[Input, Output],
        verbose: bool,
        jsonl: bool,
    ) -> EvalReport | Awaitable[EvalReport]:
        event_loop = asyncio.get_event_loop()
        return await call_user_fn(
            event_loop, self.report_eval, evaluator=evaluator, result=result, verbose=verbose, jsonl=jsonl
        )

    async def _call_report_run(self, results: list[EvalReport], verbose: bool, jsonl: bool) -> bool | Awaitable[bool]:
        event_loop = asyncio.get_event_loop()
        return await call_user_fn(event_loop, self.report_run, results=results, verbose=verbose, jsonl=jsonl)


@dataclasses.dataclass
class EvaluatorInstance(SerializableDataClass, Generic[Input, Output, EvalReport]):
    evaluator: Evaluator[Input, Output]
    reporter: ReporterDef[Input, Output, EvalReport] | str | None


@dataclasses.dataclass
class EvaluatorFile(SerializableDataClass):
    evaluators: dict[str, EvaluatorInstance] = dataclasses.field(default_factory=dict)
    reporters: dict[str, ReporterDef] = dataclasses.field(default_factory=dict)

    def clear(self):
        self.evaluators.clear()
        self.reporters.clear()

    def copy(self):
        return EvaluatorFile(
            evaluators={k: v for k, v in self.evaluators.items()},
            reporters={k: v for k, v in self.reporters.items()},
        )


_evals = EvaluatorFile()
_lazy_load = False


@contextmanager
def _set_lazy_load(lazy_load: bool):
    global _lazy_load
    current = _lazy_load
    try:
        _lazy_load = lazy_load
        yield
    finally:
        _lazy_load = current


def _is_lazy_load():
    return _lazy_load


def pluralize(n, singular, plural):
    if n == 1:
        return singular
    else:
        return plural


def report_failures(evaluator: Evaluator, failing_results: Iterable[EvalResult], verbose: bool, jsonl: bool) -> None:
    eprint(
        f"{bcolors.FAIL}Evaluator {evaluator.eval_name} failed with {len(failing_results)} {pluralize(len(failing_results), 'error', 'errors')}{bcolors.ENDC}"
    )

    errors = [
        (
            result.exc_info
            if verbose or jsonl
            else "\n".join(traceback.format_exception_only(type(result.error), result.error))
        )
        for result in failing_results
    ]

    if jsonl:
        print(json.dumps({"eval_name": evaluator.eval_name, "errors": errors}))
    else:
        info = "".join(errors).rstrip()
        eprint(f"{bcolors.FAIL}{info}{bcolors.ENDC}")

        eprint(f"{bcolors.FAIL}Add --verbose to see full stack traces.{bcolors.ENDC}")


def report_evaluator_result(evaluator: Evaluator, result: EvalResultWithSummary, verbose: bool, jsonl: bool) -> bool:
    results = result.results
    summary = result.summary

    failing_results = [x for x in results if x.error]
    if len(failing_results) > 0:
        report_failures(evaluator, failing_results, verbose=verbose, jsonl=jsonl)
    else:
        print(json.dumps(summary.as_dict()) if jsonl else f"{summary}")

    return len(failing_results) == 0


default_reporter = ReporterDef(
    name="default",
    report_eval=report_evaluator_result,
    report_run=lambda results, verbose, jsonl: all(x for x in results),
)


def _make_eval_name(name: str, experiment_name: str | None):
    out = name
    if experiment_name is not None:
        out += f" [experiment_name={experiment_name}]"
    return out


def _EvalCommon(
    name: str,
    data: EvalData[Input, Output],
    task: EvalTask[Input, Output],
    scores: Sequence[EvalScorer[Input, Output]],
    experiment_name: str | None,
    trial_count: int,
    metadata: Metadata | None,
    is_public: bool,
    update: bool,
    reporter: ReporterDef[Input, Output, EvalReport] | None,
    timeout: float | None,
    max_concurrency: int | None,
    project_id: str | None,
    base_experiment_name: str | None,
    base_experiment_id: str | None,
    git_metadata_settings: GitMetadataSettings | None,
    repo_info: RepoInfo | None,
    description: str | None,
    summarize_scores: bool,
    no_send_logs: bool,
    error_score_handler: ErrorScoreHandler | None = None,
    parameters: EvalParameters | None = None,
    on_start: Callable[[ExperimentSummary], None] | None = None,
    stream: Callable[[SSEProgressEvent], None] | None = None,
    parent: str | None = None,
    state: BraintrustState | None = None,
    enable_cache: bool = True,
) -> Callable[[], Coroutine[Any, Any, EvalResultWithSummary[Input, Output]]]:
    """
    This helper is needed because in case of `_lazy_load`, we need to update
    the `_evals` global immediately instead of whenever the coroutine is
    awaited.
    """
    eval_name = _make_eval_name(name, experiment_name)

    global _evals
    if eval_name in _evals.evaluators:
        eval_name = f"{eval_name}_{len(_evals.evaluators)}"

    evaluator = Evaluator(
        eval_name=eval_name,
        project_name=name,
        data=data,
        task=task,
        scores=scores,
        experiment_name=experiment_name,
        trial_count=trial_count,
        metadata=metadata,
        is_public=is_public,
        update=update,
        timeout=timeout,
        max_concurrency=max_concurrency,
        project_id=project_id,
        base_experiment_name=base_experiment_name,
        base_experiment_id=base_experiment_id,
        git_metadata_settings=git_metadata_settings,
        repo_info=repo_info,
        error_score_handler=error_score_handler,
        description=description,
        summarize_scores=summarize_scores,
        parameters=parameters,
    )

    if _lazy_load:
        _evals.evaluators[eval_name] = EvaluatorInstance(evaluator=evaluator, reporter=reporter)

        # Better to return this empty object than have an annoying-to-use signature.
        async def make_empty_summary():
            return EvalResultWithSummary(summary=build_local_summary(evaluator, []), results=[])

        return make_empty_summary
    else:
        if isinstance(reporter, str):
            raise ValueError(
                "Must specify a reporter object, not a name. Can only specify reporter names when running 'braintrust eval'"
            )

        reporter = reporter or default_reporter

        if base_experiment_name is None and isinstance(evaluator.data, BaseExperiment):
            base_experiment_name = evaluator.data.name

        dataset = None
        if isinstance(evaluator.data, Dataset):
            dataset = evaluator.data

        # NOTE: This code is duplicated with run_evaluator_task in py/src/braintrust/cli/eval.py.
        # Make sure to update those arguments if you change this.
        experiment = None
        if not no_send_logs and parent is None:
            experiment = init_experiment(
                project_name=evaluator.project_name if evaluator.project_id is None else None,
                project_id=evaluator.project_id,
                experiment_name=evaluator.experiment_name,
                description=evaluator.description,
                metadata=evaluator.metadata,
                is_public=evaluator.is_public,
                update=evaluator.update,
                base_experiment=base_experiment_name,
                base_experiment_id=base_experiment_id,
                git_metadata_settings=evaluator.git_metadata_settings,
                repo_info=evaluator.repo_info,
                dataset=dataset,
                state=state,
            )

            if on_start:
                summary = experiment.summarize(summarize_scores=False)
                on_start(summary)

        async def run_to_completion():
            with parent_context(parent, state):
                try:
                    ret = await run_evaluator(experiment, evaluator, 0, [], stream, state, enable_cache)
                    reporter.report_eval(evaluator, ret, verbose=True, jsonl=False)
                    return ret
                finally:
                    if experiment:
                        experiment.flush()
                    elif state is not None:
                        state.flush()

        return run_to_completion


async def EvalAsync(
    name: str,
    data: EvalData[Input, Output],
    task: EvalTask[Input, Output],
    scores: Sequence[EvalScorer[Input, Output]],
    experiment_name: str | None = None,
    trial_count: int = 1,
    metadata: Metadata | None = None,
    is_public: bool = False,
    update: bool = False,
    reporter: ReporterDef[Input, Output, EvalReport] | None = None,
    timeout: float | None = None,
    max_concurrency: int | None = None,
    project_id: str | None = None,
    base_experiment_name: str | None = None,
    base_experiment_id: str | None = None,
    git_metadata_settings: GitMetadataSettings | None = None,
    repo_info: RepoInfo | None = None,
    error_score_handler: ErrorScoreHandler | None = None,
    description: str | None = None,
    summarize_scores: bool = True,
    no_send_logs: bool = False,
    parameters: EvalParameters | None = None,
    on_start: Callable[[ExperimentSummary], None] | None = None,
    stream: Callable[[SSEProgressEvent], None] | None = None,
    parent: str | None = None,
    state: BraintrustState | None = None,
    enable_cache: bool = True,
) -> EvalResultWithSummary[Input, Output]:
    """
    A function you can use to define an evaluator. This is a convenience wrapper around the `Evaluator` class.

    Use this function over `Eval()` when you are running in an async context, including in a Jupyter notebook.

    Example:
    ```python
    await EvalAsync(
        name="my-evaluator",
        data=lambda: [
            EvalCase(input=1, expected=2),
            EvalCase(input=2, expected=4),
        ],
        task=lambda input, hooks: input * 2,
        scores=[
            NumericDiff,
        ],
    )
    ```

    :param name: The name of the evaluator. This corresponds to a project name in Braintrust.
    :param data: Returns an iterator over the evaluation dataset. Each element of the iterator should be a `EvalCase`.
    :param task: Runs the evaluation task on a single input. The `hooks` object can be used to add metadata to the evaluation.
    :param scores: A list of scorers to evaluate the results of the task. Each scorer can be a Scorer object or a function
    that takes an `EvalScorerArgs` object and returns a `Score` object.
    :param experiment_name: (Optional) Experiment name. If not specified, a name will be generated automatically.
    :param trial_count: The number of times to run the evaluator per input. This is useful for evaluating applications that
    have non-deterministic behavior and gives you both a stronger aggregate measure and a sense of the variance in the results.
    :param metadata: (Optional) A dictionary with additional data about the test example, model outputs, or just about
    anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log
    the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata`
    can be any JSON-serializable type, but its keys must be strings.
    :param is_public: (Optional) Whether the experiment should be public. Defaults to false.
    :param reporter: (Optional) A reporter that takes an evaluator and its result and returns a report.
    :param timeout: (Optional) The duration, in seconds, after which to time out the evaluation.
    Defaults to None, in which case there is no timeout.
    :param project_id: (Optional) If specified, uses the given project ID instead of the evaluator's name to identify the project.
    :param base_experiment_name: An optional experiment name to use as a base. If specified, the new experiment will be
    summarized and compared to this experiment.
    :param base_experiment_id: An optional experiment id to use as a base. If specified, the new experiment will be
    summarized and compared to this experiment. This takes precedence over `base_experiment_name` if specified.
    :param git_metadata_settings: Optional settings for collecting git metadata. By default, will collect all git metadata fields allowed in org-level settings.
    :param repo_info: Optionally explicitly specify the git metadata for this experiment. This takes precedence over `git_metadata_settings` if specified.
    :param error_score_handler: Optionally supply a custom function to specifically handle score values when tasks or scoring functions have errored.
    :param description: An optional description for the experiment.
    :param summarize_scores: Whether to summarize the scores of the experiment after it has run.
    :param no_send_logs: Do not send logs to Braintrust. When True, the evaluation runs locally
    and builds a local summary instead of creating an experiment. Defaults to False.
    :param parameters: A set of parameters that will be passed to the evaluator.
    :param on_start: An optional callback that will be called when the evaluation starts. It receives the
    `ExperimentSummary` object, which can be used to display metadata about the experiment.
    :param stream: A function that will be called with progress events, which can be used to
    display intermediate progress.
    :param parent: If specified, instead of creating a new experiment object, the Eval() will populate
    the object or span specified by this parent.
    :param state: Optional BraintrustState to use for the evaluation. If not specified, the global login state will be used.
    :param enable_cache: Whether to enable the span cache for this evaluation. Defaults to True. The span cache stores
    span data on disk to minimize memory usage and allow scorers to read spans without server round-trips.
    :return: An `EvalResultWithSummary` object, which contains all results and a summary.
    """
    f = _EvalCommon(
        name=name,
        data=data,
        task=task,
        scores=scores,
        experiment_name=experiment_name,
        trial_count=trial_count,
        metadata=metadata,
        is_public=is_public,
        update=update,
        reporter=reporter,
        timeout=timeout,
        max_concurrency=max_concurrency,
        project_id=project_id,
        base_experiment_name=base_experiment_name,
        base_experiment_id=base_experiment_id,
        git_metadata_settings=git_metadata_settings,
        repo_info=repo_info,
        description=description,
        summarize_scores=summarize_scores,
        no_send_logs=no_send_logs,
        parameters=parameters,
        on_start=on_start,
        stream=stream,
        parent=parent,
        state=state,
        enable_cache=enable_cache,
    )

    return await f()


_has_printed_eval_async_warning = False


def Eval(
    name: str,
    data: EvalData[Input, Output],
    task: EvalTask[Input, Output],
    scores: Sequence[EvalScorer[Input, Output]],
    experiment_name: str | None = None,
    trial_count: int = 1,
    metadata: Metadata | None = None,
    is_public: bool = False,
    update: bool = False,
    reporter: ReporterDef[Input, Output, EvalReport] | None = None,
    timeout: float | None = None,
    max_concurrency: int | None = None,
    project_id: str | None = None,
    base_experiment_name: str | None = None,
    base_experiment_id: str | None = None,
    git_metadata_settings: GitMetadataSettings | None = None,
    repo_info: RepoInfo | None = None,
    error_score_handler: ErrorScoreHandler | None = None,
    description: str | None = None,
    summarize_scores: bool = True,
    no_send_logs: bool = False,
    parameters: EvalParameters | None = None,
    on_start: Callable[[ExperimentSummary], None] | None = None,
    stream: Callable[[SSEProgressEvent], None] | None = None,
    parent: str | None = None,
    state: BraintrustState | None = None,
    enable_cache: bool = True,
) -> EvalResultWithSummary[Input, Output]:
    """
    A function you can use to define an evaluator. This is a convenience wrapper around the `Evaluator` class.

    For callers running in an async context, use `EvalAsync()` instead.

    Example:
    ```python
    Eval(
        name="my-evaluator",
        data=lambda: [
            EvalCase(input=1, expected=2),
            EvalCase(input=2, expected=4),
        ],
        task=lambda input, hooks: input * 2,
        scores=[
            NumericDiff,
        ],
    )
    ```

    :param name: The name of the evaluator. This corresponds to a project name in Braintrust.
    :param data: Returns an iterator over the evaluation dataset. Each element of the iterator should be a `EvalCase`.
    :param task: Runs the evaluation task on a single input. The `hooks` object can be used to add metadata to the evaluation.
    :param scores: A list of scorers to evaluate the results of the task. Each scorer can be a Scorer object or a function
    that takes an `EvalScorerArgs` object and returns a `Score` object.
    :param experiment_name: (Optional) Experiment name. If not specified, a name will be generated automatically.
    :param trial_count: The number of times to run the evaluator per input. This is useful for evaluating applications that
    have non-deterministic behavior and gives you both a stronger aggregate measure and a sense of the variance in the results.
    :param metadata: (Optional) A dictionary with additional data about the test example, model outputs, or just about
    anything else that's relevant, that you can use to help find and analyze examples later. For example, you could log
    the `prompt`, example's `id`, or anything else that would be useful to slice/dice later. The values in `metadata`
    can be any JSON-serializable type, but its keys must be strings.
    :param is_public: (Optional) Whether the experiment should be public. Defaults to false.
    :param reporter: (Optional) A reporter that takes an evaluator and its result and returns a report.
    :param timeout: (Optional) The duration, in seconds, after which to time out the evaluation.
    Defaults to None, in which case there is no timeout.
    :param project_id: (Optional) If specified, uses the given project ID instead of the evaluator's name to identify the project.
    :param base_experiment_name: An optional experiment name to use as a base. If specified, the new experiment will be
    summarized and compared to this experiment.
    :param base_experiment_id: An optional experiment id to use as a base. If specified, the new experiment will be
    summarized and compared to this experiment. This takes precedence over `base_experiment_name` if specified.
    :param git_metadata_settings: Optional settings for collecting git metadata. By default, will collect all git metadata fields allowed in org-level settings.
    :param repo_info: Optionally explicitly specify the git metadata for this experiment. This takes precedence over `git_metadata_settings` if specified.
    :param error_score_handler: Optionally supply a custom function to specifically handle score values when tasks or scoring functions have errored.
    :param description: An optional description for the experiment.
    :param summarize_scores: Whether to summarize the scores of the experiment after it has run.
    :param no_send_logs: Do not send logs to Braintrust. When True, the evaluation runs locally
    and builds a local summary instead of creating an experiment. Defaults to False.
    :param parameters: A set of parameters that will be passed to the evaluator.
    :param on_start: An optional callback that will be called when the evaluation starts. It receives the
    `ExperimentSummary` object, which can be used to display metadata about the experiment.
    :param stream: A function that will be called with progress events, which can be used to
    display intermediate progress.
    :param parent: If specified, instead of creating a new experiment object, the Eval() will populate
    the object or span specified by this parent.
    :param state: Optional BraintrustState to use for the evaluation. If not specified, the global login state will be used.
    :param enable_cache: Whether to enable the span cache for this evaluation. Defaults to True. The span cache stores
    span data on disk to minimize memory usage and allow scorers to read spans without server round-trips.
    :return: An `EvalResultWithSummary` object, which contains all results and a summary.
    """

    f = _EvalCommon(
        name=name,
        data=data,
        task=task,
        scores=scores,
        experiment_name=experiment_name,
        trial_count=trial_count,
        metadata=metadata,
        is_public=is_public,
        update=update,
        reporter=reporter,
        timeout=timeout,
        max_concurrency=max_concurrency,
        project_id=project_id,
        base_experiment_name=base_experiment_name,
        base_experiment_id=base_experiment_id,
        git_metadata_settings=git_metadata_settings,
        repo_info=repo_info,
        error_score_handler=error_score_handler,
        description=description,
        summarize_scores=summarize_scores,
        no_send_logs=no_send_logs,
        parameters=parameters,
        on_start=on_start,
        stream=stream,
        parent=parent,
        state=state,
        enable_cache=enable_cache,
    )

    # https://stackoverflow.com/questions/55409641/asyncio-run-cannot-be-called-from-a-running-event-loop-when-using-jupyter-no
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # 'RuntimeError: There is no current event loop...'
        loop = None
    if loop:
        # Notebook or existing async context.
        global _has_printed_eval_async_warning
        global _lazy_load
        if not _has_printed_eval_async_warning and not _lazy_load:
            _has_printed_eval_async_warning = True
            eprint(
                "`Eval()` was called from an async context. For better "
                "performance, it is recommended to use `await EvalAsync()` "
                "instead."
            )
        # Return a `Task` to be compatible with a previous signature where the
        # return type included `Awaitable`.
        return loop.create_task(f())  # type: ignore
    else:
        return asyncio.run(f())


def Reporter(
    name: str,
    report_eval: Callable[
        [Evaluator[Input, Output], EvalResultWithSummary[Input, Output], bool, bool],
        EvalReport | Awaitable[EvalReport],
    ],
    report_run: Callable[[list[EvalReport], bool, bool], bool | Awaitable[bool]],
):
    """
    A function you can use to define a reporter. This is a convenience wrapper around the `ReporterDef` class.

    Example:
    ```python
    def report_eval(evaluator, result, verbose, jsonl):
        return str(result.summary)

    def report_run(results, verbose, jsonl):
        return True

    Reporter(
        name="my-reporter",
        report_eval=report_eval,
        report_run=report_run,
    )
    ```

    :param name: The name of the reporter.
    :param report_eval: A function that takes an evaluator and its result and returns a report.
    :param report_run: A function that takes all evaluator results and returns a boolean indicating whether the run was successful.
    """
    ret = ReporterDef(name=name, report_eval=report_eval, report_run=report_run)

    global _evals
    if name in _evals.reporters:
        raise ValueError(f"Reporter {name} already exists")

    if _lazy_load:
        _evals.reporters[name] = ret

    return ret


@dataclasses.dataclass
class Filter:
    path: list[str]
    pattern: re.Pattern


def serialize_json_with_plain_string(v: Any) -> str:
    if isinstance(v, str):
        return v
    else:
        return json.dumps(v)


def deserialize_plain_string_as_json(s: str) -> Any:
    try:
        return {"value": json.loads(s)}
    except json.JSONDecodeError as e:
        return {"value": s, "error": e}


def parse_filters(filters: list[str]) -> list[Filter]:
    result = []
    for f in filters:
        equals_idx = f.index("=")
        if equals_idx == -1:
            raise ValueError(f"Invalid filter {f}")
        path, value = f[:equals_idx], f[equals_idx + 1 :]
        deserialized_value = deserialize_plain_string_as_json(value)["value"]
        if not isinstance(deserialized_value, str):
            deserialized_value = value
        result.append(
            Filter(
                path=path.split("."),
                pattern=re.compile(deserialized_value),
            )
        )

    return result


def evaluate_filter(object, filter: Filter):
    key = object
    for p in filter.path:
        key = key.get(p)
        if key is None:
            return False
    return filter.pattern.match(serialize_json_with_plain_string(key)) is not None


class DictEvalHooks(dict[str, Any]):
    def __init__(
        self,
        metadata: Any | None = None,
        expected: Any | None = None,
        trial_index: int = 0,
        tags: Sequence[str] | None = None,
        report_progress: Callable[[TaskProgressEvent], None] = None,
        parameters: dict[str, Any] | None = None,
    ):
        if metadata is not None:
            self.update({"metadata": metadata})
        if expected is not None:
            self.update({"expected": expected})
        self.update({"trial_index": trial_index})
        self._span = None
        if tags is not None:
            self.update({"tags": tags})
        else:
            self.update({"tags": []})

        self._report_progress = report_progress
        self._parameters = parameters

    @property
    def metadata(self):
        return self.get("metadata")

    @property
    def expected(self):
        return self.get("expected")

    @property
    def trial_index(self) -> int:
        return self.get("trial_index", 0)

    @property
    def span(self) -> Span | None:
        return self._span

    def set_span(self, span: Span | None):
        self._span = span

    @property
    def tags(self) -> Sequence[str]:
        return self["tags"]

    @tags.setter
    def tags(self, tags: Sequence[str] | None) -> None:
        self["tags"] = [] if tags is None else list(tags)

    def meta(self, **info: Any):
        warnings.warn(
            "meta() is deprecated. Use the metadata field directly instead.", DeprecationWarning, stacklevel=2
        )

        if self.get("metadata") is None:
            self.update({"metadata": {}})

        self.get("metadata").update(info)  # type: ignore

    def report_progress(self, event: TaskProgressEvent):
        if self._report_progress:
            return self._report_progress(event)

    @property
    def parameters(self) -> dict[str, Any] | None:
        return self._parameters


def init_experiment(
    project_name: str | None = None, experiment_name: str | None = None, set_current: bool = False, **kwargs: Any
) -> Experiment:
    ret = _init_experiment(project=project_name, experiment=experiment_name, set_current=set_current, **kwargs)
    summary = ret.summarize(summarize_scores=False)
    eprint(f"Experiment {ret.name} is running at {summary.experiment_url}")
    return ret


class EvalThreadPoolSingleton:
    def __init__(self):
        self._thread_pool = None
        self._max_workers = cpu_count()

    def set_max_workers(self, max_workers):
        assert self._thread_pool is None, "Cannot set max_workers. Thread pool has already been initialized"
        self._max_workers = max_workers

    def thread_pool(self):
        if self._thread_pool is None:
            self._thread_pool = ThreadPoolExecutor(max_workers=self._max_workers)
        return self._thread_pool


_THREAD_POOL_SINGLETON = ResourceManager(EvalThreadPoolSingleton())


def set_thread_pool_max_workers(max_workers):
    """
    Set the maximum number of threads to use for running evaluators. By default, this is the number of
    CPUs on the machine.
    """
    with _THREAD_POOL_SINGLETON.get() as obj:
        obj.set_max_workers(max_workers)


def _scorer_name(scorer, scorer_idx):
    def helper():
        if hasattr(scorer, "_name"):
            return scorer._name()
        elif hasattr(scorer, "__name__"):
            return scorer.__name__
        else:
            return type(scorer).__name__

    ret = helper()
    if ret == "<lambda>":
        ret = f"scorer_{scorer_idx}"
    return ret


async def run_evaluator(
    experiment: Experiment | None,
    evaluator: Evaluator[Input, Output],
    position: int | None,
    filters: list[Filter],
    stream: Callable[[SSEProgressEvent], None] | None = None,
    state: BraintrustState | None = None,
    enable_cache: bool = True,
) -> EvalResultWithSummary[Input, Output]:
    """Wrapper on _run_evaluator_internal that times out execution after evaluator.timeout."""
    results = await asyncio.wait_for(
        _run_evaluator_internal(experiment, evaluator, position, filters, stream, state, enable_cache), evaluator.timeout
    )

    if experiment:
        summary = experiment.summarize(summarize_scores=evaluator.summarize_scores)
    else:
        summary = build_local_summary(evaluator, results)

    return EvalResultWithSummary(results=results, summary=summary)


def default_error_score_handler(
    root_span: Span,
    data: EvalCase[Input, Output],
    unhandled_scores: list[str],
):
    scores = {s: 0 for s in unhandled_scores}
    root_span.log(scores=scores)
    return scores


async def _run_evaluator_internal(
    experiment,
    evaluator: Evaluator,
    position: int | None,
    filters: list[Filter],
    stream: Callable[[SSEProgressEvent], None] | None = None,
    state: BraintrustState | None = None,
    enable_cache: bool = True,
):
    # Start span cache for this eval (it's disabled by default to avoid temp files outside of evals)
    if state is None:
        from braintrust.logger import _internal_get_global_state

        state = _internal_get_global_state()

    if enable_cache:
        state.span_cache.start()
    try:
        return await _run_evaluator_internal_impl(experiment, evaluator, position, filters, stream, state)
    finally:
        # Clean up disk-based span cache after eval completes and stop caching
        if enable_cache:
            state.span_cache.dispose()
            state.span_cache.stop()


async def _run_evaluator_internal_impl(
    experiment,
    evaluator: Evaluator,
    position: int | None,
    filters: list[Filter],
    stream: Callable[[SSEProgressEvent], None] | None = None,
    state: BraintrustState | None = None,
):
    event_loop = asyncio.get_event_loop()

    async def await_or_run_scorer(root_span, scorer, name, **kwargs):
        # Merge purpose into parent's propagated_event rather than replacing it
        parent_propagated = root_span.propagated_event or {}
        merged_propagated = merge_dicts(
            {**parent_propagated},
            {"span_attributes": {"purpose": "scorer"}},
        )
        # Strip trace from logged input - it's internal plumbing that shouldn't appear in spans
        logged_input = {k: v for k, v in kwargs.items() if k != "trace"}
        with root_span.start_span(
            name=name,
            span_attributes={"type": SpanTypeAttribute.SCORE, "purpose": "scorer"},
            propagated_event=merged_propagated,
            input=logged_input,
        ) as span:
            score = scorer
            if hasattr(scorer, "eval_async"):
                score = scorer.eval_async

            scorer_args = kwargs

            result = await call_user_fn(event_loop, score, **scorer_args)
            if isinstance(result, dict):
                try:
                    result = Score.from_dict(result)
                except Exception as e:
                    raise ValueError(f"When returning a dict, it must be a valid Score object. Got: {result}") from e

            if isinstance(result, Iterable):
                for s in result:
                    if not is_score(s):
                        raise ValueError(
                            f"When returning an array of scores, each score must be a valid Score object. Got: {s}"
                        )
                result = list(result)
            elif is_score(result):
                result = [result]
            else:
                result = [Score(name=name, score=result)]

            def get_other_fields(s):
                return {k: v for k, v in s.as_dict().items() if k not in ["metadata", "name"]}

            result_metadata = {r.name: r.metadata for r in result} if len(result) != 1 else result[0].metadata
            result_output = (
                {r.name: get_other_fields(r) for r in result} if len(result) != 1 else get_other_fields(result[0])
            )

            scores = {r.name: r.score for r in result}
            span.log(output=result_output, metadata=result_metadata, scores=scores)
            return result

    # First, resolve the scorers if they are classes
    scorers = [scorer() if inspect.isclass(scorer) and is_scorer(scorer) else scorer for scorer in evaluator.scores]
    scorer_names = [_scorer_name(scorer, i) for i, scorer in enumerate(scorers)]
    unhandled_scores = scorer_names

    async def run_evaluator_task(datum, trial_index=0):
        if isinstance(datum, dict):
            datum = EvalCase.from_dict(datum)

        metadata = {**(datum.metadata or {})}
        output = None
        error = None
        exc_info = None
        scores = {}
        tags = datum.tags

        event_dataset = (
            experiment.dataset if experiment else evaluator.data if isinstance(evaluator.data, Dataset) else None
        )

        origin = (
            {
                "object_type": "dataset",
                "object_id": event_dataset.id,
                "id": datum.id,
                "created": datum.created,
                "_xact_id": datum._xact_id,
            }
            if event_dataset and datum.id and datum._xact_id
            else None
        )
        base_event = dict(
            name="eval",
            span_attributes={"type": SpanTypeAttribute.EVAL},
            input=datum.input,
            expected=datum.expected,
            tags=tags,
            origin=origin,
        )

        if experiment:
            root_span = experiment.start_span(**base_event)
        else:
            # In most cases this will be a no-op span, but if the parent is set, it will use that ctx.
            root_span = start_span(state=state, **base_event)

        with root_span:
            try:

                def report_progress(event: TaskProgressEvent):
                    if not stream:
                        return
                    stream(
                        SSEProgressEvent(
                            id=root_span.id, origin=origin, name=evaluator.eval_name, object_type="task", **event
                        )
                    )

                hooks = DictEvalHooks(
                    metadata,
                    expected=datum.expected,
                    trial_index=trial_index,
                    tags=tags,
                    report_progress=report_progress,
                    parameters=evaluator.parameters,
                )

                # Check if the task takes a hooks argument
                task_args = [datum.input]
                try:
                    if len(inspect.signature(evaluator.task).parameters) == 2:
                        task_args.append(hooks)
                except:
                    pass

                with root_span.start_span("task", span_attributes={"type": SpanTypeAttribute.TASK}) as span:
                    hooks.set_span(span)
                    output = await await_or_run(event_loop, evaluator.task, *task_args)
                    span.log(input=task_args[0], output=output)
                tags = hooks.tags if hooks.tags else None
                root_span.log(output=output, metadata=metadata, tags=tags)

                # Create trace object for scorers
                from braintrust.trace import LocalTrace

                async def ensure_spans_flushed():
                    # Flush native Braintrust spans
                    if experiment:
                        await asyncio.get_event_loop().run_in_executor(
                            None, lambda: experiment.state.flush()
                        )
                    elif state:
                        await asyncio.get_event_loop().run_in_executor(None, lambda: state.flush())
                    else:
                        from braintrust.logger import flush as flush_logger

                        await asyncio.get_event_loop().run_in_executor(None, flush_logger)

                    # Also flush OTEL spans if registered
                    if state:
                        await state.flush_otel()

                experiment_id = None
                if experiment:
                    try:
                        experiment_id = experiment.id
                    except:
                        experiment_id = None

                trace = None
                if state or experiment:
                    # Get the state to use
                    trace_state = state
                    if not trace_state and experiment:
                        trace_state = experiment.state
                    if not trace_state:
                        # Fall back to global state
                        from braintrust.logger import _internal_get_global_state

                        trace_state = _internal_get_global_state()

                    # Access root_span_id from the concrete SpanImpl instance
                    # The Span interface doesn't expose this but SpanImpl has it
                    root_span_id_value = getattr(root_span, "root_span_id", root_span.id)

                    # Check if there's a parent in the context to determine object_type and object_id
                    from braintrust.span_identifier_v3 import SpanComponentsV3, span_object_type_v3_to_typed_string

                    parent_str = trace_state.current_parent.get()
                    parent_components = None
                    if parent_str:
                        try:
                            parent_components = SpanComponentsV3.from_str(parent_str)
                        except Exception:
                            # If parsing fails, parent_components stays None
                            pass

                    # Determine object_type and object_id based on parent or experiment
                    if parent_components:
                        trace_object_type = span_object_type_v3_to_typed_string(parent_components.object_type)
                        trace_object_id = parent_components.object_id or ""
                    else:
                        trace_object_type = "experiment"
                        trace_object_id = experiment_id or ""

                    trace = LocalTrace(
                        object_type=trace_object_type,
                        object_id=trace_object_id,
                        root_span_id=root_span_id_value,
                        ensure_spans_flushed=ensure_spans_flushed,
                        state=trace_state,
                    )

                score_promises = [
                    asyncio.create_task(
                        await_or_run_scorer(
                            root_span,
                            score,
                            name,
                            **{
                                "input": datum.input,
                                "expected": datum.expected,
                                "metadata": metadata,
                                "output": output,
                                "trace": trace,
                            },
                        )
                    )
                    for score, name in zip(scorers, scorer_names)
                ]
                passing_scorers_and_results = []
                failing_scorers_and_exceptions = []
                for name, p in zip(scorer_names, score_promises):
                    try:
                        score_results = await p
                        for score in score_results:
                            passing_scorers_and_results.append((score.name, score))
                            scores[score.name] = score.score
                    except Exception as e:
                        exc_info = traceback.format_exc()
                        failing_scorers_and_exceptions.append((name, e, exc_info))

                nonlocal unhandled_scores
                unhandled_scores = None
                if failing_scorers_and_exceptions:
                    scorer_errors = {
                        scorer_name: exc_info for scorer_name, _, exc_info in failing_scorers_and_exceptions
                    }
                    metadata["scorer_errors"] = scorer_errors
                    root_span.log(metadata=metadata, tags=tags)
                    names = ", ".join(scorer_errors.keys())
                    exceptions = [x[1] for x in failing_scorers_and_exceptions]
                    unhandled_scores = list(scorer_errors.keys())
                    eprint(
                        f"Found exceptions for the following scorers: {names}",
                        exceptions,
                    )
            except Exception as e:
                exc_type, exc_value, tb = sys.exc_info()
                root_span.log(error=stringify_exception(exc_type, exc_value, tb))

                error = e
                # Python3.10 has a different set of arguments to format_exception than earlier versions,
                # so just capture the stack trace here.
                exc_info = traceback.format_exc()

        return EvalResult(
            input=datum.input,
            expected=datum.expected,
            metadata=metadata,
            tags=tags,
            output=output,
            scores={
                **(
                    evaluator.error_score_handler(root_span, datum, unhandled_scores) or {}
                    if evaluator.error_score_handler is not None and unhandled_scores
                    else {}
                ),
                **scores,
            },
            error=error,
            exc_info=exc_info,
        )

    data_iterator = evaluator.data

    if inspect.isclass(data_iterator):
        data_iterator = data_iterator()

    if isinstance(data_iterator, BaseExperiment):
        if experiment is None:
            raise ValueError(
                "Cannot use BaseExperiment() without connecting to Braintrust (you most likely set --no-send-logs)"
            )
        base_experiment_name = data_iterator.name
        if base_experiment_name is None:
            base_experiment = experiment.fetch_base_experiment()
            if base_experiment is None:
                raise Exception("BaseExperiment() failed to fetch base experiment")
            base_experiment_name = base_experiment.name
        data_iterator = _init_experiment(
            project=evaluator.project_name if evaluator.project_id is None else None,
            project_id=evaluator.project_id,
            experiment=base_experiment_name,
            open=True,
            set_current=False,
        ).as_dataset()

    if inspect.isfunction(data_iterator) or inspect.isroutine(data_iterator):
        data_iterator = data_iterator()

    if not inspect.isasyncgen(data_iterator):

        async def to_async(it):
            for d in it:
                yield d

        data_iterator = to_async(data_iterator)

    async def filtered_iterator(it):
        async for datum in it:
            if all(evaluate_filter(datum, f) for f in filters):
                yield datum

    max_concurrency_semaphore = (
        asyncio.Semaphore(evaluator.max_concurrency) if evaluator.max_concurrency is not None else None
    )

    async def with_max_concurrency(coro):
        if max_concurrency_semaphore:
            async with max_concurrency_semaphore:
                return await coro
        else:
            return await coro

    tasks = []
    with async_tqdm(
        filtered_iterator(data_iterator),
        desc=f"{evaluator.eval_name} (data)",
        position=position,
        disable=position is None,
    ) as pbar:
        async for datum in pbar:
            for trial_index in range(evaluator.trial_count):
                tasks.append(asyncio.create_task(with_max_concurrency(run_evaluator_task(datum, trial_index))))

    results = []
    for task in std_tqdm(tasks, desc=f"{evaluator.eval_name} (tasks)", position=position, disable=position is None):
        results.append(await task)
    return results


def build_local_summary(
    evaluator: Evaluator[Input, Output], results: list[EvalResultWithSummary[Input, Output]]
) -> ExperimentSummary:
    scores_by_name = defaultdict(lambda: (0, 0))
    for result in results:
        for name, score in result.scores.items():
            if score is None:
                continue
            curr = scores_by_name[name]
            scores_by_name[name] = (curr[0] + score, curr[1] + 1)
    longest_score_name = max(len(name) for name in scores_by_name) if scores_by_name else 0
    avg_scores = {
        name: ScoreSummary(
            name=name,
            score=total / count,
            diff=None,
            improvements=0,
            regressions=0,
            _longest_score_name=longest_score_name,
        )
        for name, (total, count) in scores_by_name.items()
    }
    return ExperimentSummary(
        experiment_id=None,
        experiment_name=evaluator.eval_name,
        project_name=evaluator.project_name,
        project_id=None,
        project_url=None,
        experiment_url=None,
        comparison_experiment_name=None,
        scores=avg_scores,
        metrics={},
    )


__all__ = ["Evaluator", "Eval", "EvalAsync", "Score", "EvalCase", "EvalHooks", "BaseExperiment", "Reporter"]
