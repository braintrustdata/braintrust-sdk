import abc
import asyncio
import contextvars
import dataclasses
import inspect
import json
import re
import traceback
from collections import defaultdict
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from enum import Enum
from multiprocessing import cpu_count
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Iterator, List, Optional, TypeVar, Union

import exceptiongroup
from braintrust_core.score import Score, Scorer
from braintrust_core.span_types import SpanTypeAttribute
from braintrust_core.util import (
    SerializableDataClass,
    eprint,
)
from tqdm.asyncio import tqdm as async_tqdm
from tqdm.auto import tqdm as std_tqdm

from .logger import NOOP_SPAN, ExperimentSummary, Metadata, ScoreSummary, Span
from .logger import init as _init_experiment
from .resource_manager import ResourceManager

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
class EvalCase(SerializableDataClass):
    """
    An evaluation case. This is a single input to the evaluation task, along with an optional expected
    output, metadata, and tags.
    """

    input: Input
    expected: Optional[Output] = None
    metadata: Optional[Metadata] = None
    tags: Optional[List[str]] = None


# Inheritance doesn't quite work for dataclasses, so we redefine the fields
# from EvalCase here.
@dataclasses.dataclass
class EvalResult(SerializableDataClass):
    """The result of an evaluation. This includes the input, expected output, actual output, and metadata."""

    input: Input
    output: Output
    scores: Dict[str, Optional[float]]
    expected: Optional[Output] = None
    metadata: Optional[Metadata] = None
    tags: Optional[List[str]] = None
    error: Optional[Exception] = None
    exc_info: Optional[str] = None


class EvalHooks(abc.ABC):
    """
    An object that can be used to add metadata to an evaluation. This is passed to the `task` function.
    """

    @property
    @abc.abstractmethod
    def span(self) -> Span:
        """
        Access the span under which the task is run. Also accessible via braintrust.current_span()
        """

    @abc.abstractmethod
    def meta(self, **info) -> None:
        """
        Adds metadata to the evaluation. This metadata will be logged to the Braintrust. You can pass in metadaa
        as keyword arguments, e.g. `hooks.meta(foo="bar")`.
        """
        ...


class EvalScorerArgs(SerializableDataClass):
    """
    Arguments passed to an evaluator scorer. This includes the input, expected output, actual output, and metadata.
    """

    input: Input
    output: Output
    expected: Optional[Output] = None
    metadata: Optional[Metadata] = None


OneOrMoreScores = Union[float, int, bool, None, Score, List[Score]]

EvalScorer = Union[
    Scorer,
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

    name: Optional[str] = None
    """
    The name of the base experiment to use. If unspecified, Braintrust will automatically figure out the best base
    using your git history (or fall back to timestamps).
    """


@dataclasses.dataclass
class Evaluator:
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

    data: Union[
        Iterator[EvalCase],
        Awaitable[Iterator[EvalCase]],
        Callable[[], Union[Iterator[EvalCase], Awaitable[Iterator[EvalCase]]]],
        BaseExperiment,
        type,
    ]
    """
    Returns an iterator over the evaluation dataset. Each element of the iterator should be an `EvalCase` or a dict
    with the same fields as an `EvalCase` (`input`, `expected`, `metadata`).
    """

    task: Union[
        Callable[[Input, EvalHooks], Union[Output, Awaitable[Output]]],
        Callable[[Input], Union[Output, Awaitable[Output]]],
    ]
    """
    Runs the evaluation task on a single input. The `hooks` object can be used to add metadata to the evaluation.
    """

    scores: List[EvalScorer]
    """
    A list of scorers to evaluate the results of the task. Each scorer can be a Scorer object or a function
    that takes `input`, `output`, and `expected` arguments and returns a `Score` object. The function can be async.
    """

    experiment_name: Optional[str]
    """
    Optional experiment name. If not specified, a name will be generated automatically.
    """

    metadata: Optional[Metadata]
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


@dataclasses.dataclass
class EvalResultWithSummary(SerializableDataClass):
    summary: ExperimentSummary
    results: List[EvalResult]


EvalReport = TypeVar("EvalReport")


async def await_or_run(event_loop, f, *args, **kwargs):
    if inspect.iscoroutinefunction(f):
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


async def call_user_fn(event_loop, fn, **kwargs):
    signature = inspect.signature(fn)
    accepts_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values())

    positional_args = []
    final_kwargs = {}

    for name, param in signature.parameters.items():
        if param.kind == inspect.Parameter.VAR_KEYWORD:
            continue

        if name in kwargs:
            final_kwargs[name] = kwargs.pop(name)
        else:
            next_arg = list(kwargs.keys())[0]
            final_kwargs[name] = kwargs.pop(next_arg)

    if accepts_kwargs:
        final_kwargs.update(kwargs)

    return await await_or_run(event_loop, fn, *positional_args, **final_kwargs)


@dataclasses.dataclass
class ReporterDef(SerializableDataClass):
    """
    A reporter takes an evaluator and its result and returns a report.
    """

    name: str
    """
    The name of the reporter.
    """

    report_eval: Callable[[Evaluator, EvalResultWithSummary, bool, bool], Union[EvalReport, Awaitable[EvalReport]]]
    """
    A function that takes an evaluator and its result and returns a report.
    """

    report_run: Callable[[List[EvalReport], bool, bool], Union[bool, Awaitable[bool]]]
    """
    A function that takes all evaluator results and returns a boolean indicating whether the run was successful.
    If you return false, the `braintrust eval` command will exit with a non-zero status code.
    """

    async def _call_report_eval(self, evaluator: Evaluator, result: EvalResultWithSummary, verbose: bool, jsonl: bool):
        event_loop = asyncio.get_event_loop()
        return await call_user_fn(
            event_loop, self.report_eval, evaluator=evaluator, result=result, verbose=verbose, jsonl=jsonl
        )

    async def _call_report_run(self, results: List[EvalReport], verbose: bool, jsonl: bool):
        event_loop = asyncio.get_event_loop()
        return await call_user_fn(event_loop, self.report_run, results=results, verbose=verbose, jsonl=jsonl)


@dataclasses.dataclass
class EvaluatorInstance(SerializableDataClass):
    evaluator: Evaluator
    reporter: Optional[Union[ReporterDef, str]]


@dataclasses.dataclass
class EvaluatorFile(SerializableDataClass):
    evaluators: Dict[str, EvaluatorInstance] = dataclasses.field(default_factory=dict)
    reporters: Dict[str, ReporterDef] = dataclasses.field(default_factory=dict)

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


def pluralize(n, singular, plural):
    if n == 1:
        return singular
    else:
        return plural


def report_failures(evaluator, failing_results, verbose, jsonl):
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


def report_evaluator_result(evaluator: Evaluator, result, verbose, jsonl):
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


def _make_eval_name(name: str, experiment_name: Optional[str]):
    out = name
    if experiment_name is not None:
        out += f" [experiment_name={experiment_name}]"
    return out


def Eval(
    name: str,
    data: Callable[[], Union[Iterator[EvalCase], AsyncIterator[EvalCase]]],
    task: Callable[[Input, EvalHooks], Union[Output, Awaitable[Output]]],
    scores: List[EvalScorer],
    experiment_name: Optional[str] = None,
    trial_count: int = 1,
    metadata: Optional[Metadata] = None,
    is_public: bool = False,
    update: bool = False,
    reporter: Optional[Union[ReporterDef, str]] = None,
):
    """
    A function you can use to define an evaluator. This is a convenience wrapper around the `Evaluator` class.

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

    If you're running in an async context, e.g. in a Jupyter notebook, then `Eval` returns a `Future` object that you
    can `await`.

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
    :return: An `EvalResult` object, which contains all results and a summary.
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
    )

    if _lazy_load:
        _evals.evaluators[eval_name] = EvaluatorInstance(evaluator=evaluator, reporter=reporter)
    else:
        if reporter is not None and isinstance(reporter, str):
            raise ValueError(
                "Must specify a reporter object, not a name. Can only specify reporter names when running 'braintrust eval'"
            )

        reporter = reporter or default_reporter

        # https://stackoverflow.com/questions/55409641/asyncio-run-cannot-be-called-from-a-running-event-loop-when-using-jupyter-no
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # 'RuntimeError: There is no current event loop...'
            loop = None

        async def run_to_completion():
            experiment = init_experiment(
                evaluator.project_name,
                evaluator.experiment_name,
                metadata=evaluator.metadata,
                is_public=evaluator.is_public,
                update=evaluator.update,
            )
            try:
                ret = await run_evaluator(experiment, evaluator, 0, [])
                reporter.report_eval(evaluator, ret, verbose=True, jsonl=False)
                return ret
            finally:
                experiment.flush()

        if loop:
            return loop.create_task(run_to_completion())
        else:
            return asyncio.run(run_to_completion())


def Reporter(
    name: str,
    report_eval: Callable[[Evaluator, EvalResultWithSummary, bool, bool], Union[EvalReport, Awaitable[EvalReport]]],
    report_run: Callable[[List[EvalReport], bool, bool], Union[bool, Awaitable[bool]]],
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
    path: List[str]
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


def parse_filters(filters: List[str]) -> List[Filter]:
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


class DictEvalHooks(EvalHooks):
    def __init__(self, metadata):
        self.metadata = metadata
        self._span = None

    @property
    def span(self):
        return self._span

    def set_span(self, span):
        self._span = span

    def meta(self, **info):
        self.metadata.update(info)


def init_experiment(project_name, experiment_name: Optional[str] = None, set_current=False, **kwargs):
    ret = _init_experiment(project_name, experiment=experiment_name, set_current=set_current, **kwargs)
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


async def run_evaluator(experiment, evaluator: Evaluator, position: Optional[int], filters: List[Filter]):
    event_loop = asyncio.get_event_loop()

    async def await_or_run_scorer(root_span, scorer, name, **kwargs):
        with root_span.start_span(
            name=name, span_attributes={"type": SpanTypeAttribute.SCORE}, input=dict(**kwargs)
        ) as span:
            score = scorer.eval_async if isinstance(scorer, Scorer) else scorer

            scorer_args = kwargs

            result = await call_user_fn(event_loop, score, **scorer_args)
            if isinstance(result, Iterable):
                for s in result:
                    if not isinstance(s, Score):
                        raise ValueError(
                            f"When returning an array of scores, each score must be a non-empty object. Got: {s}"
                        )
                result = list(result)
            elif isinstance(result, Score):
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

    async def run_evaluator_task(datum):
        if isinstance(datum, dict):
            datum = EvalCase.from_dict(datum)

        metadata = {**(datum.metadata or {})}
        output = None
        error = None
        exc_info = None
        scores = {}

        if experiment:
            root_span = experiment.start_span(
                "eval",
                span_attributes={"type": SpanTypeAttribute.EVAL},
                input=datum.input,
                expected=datum.expected,
                tags=datum.tags,
            )
        else:
            root_span = NOOP_SPAN
        with root_span:
            try:
                hooks = DictEvalHooks(metadata)

                # Check if the task takes a hooks argument
                task_args = [datum.input]
                if len(inspect.signature(evaluator.task).parameters) == 2:
                    task_args.append(hooks)

                with root_span.start_span("task", span_attributes={"type": SpanTypeAttribute.TASK}) as span:
                    hooks.set_span(span)
                    output = await await_or_run(event_loop, evaluator.task, *task_args)
                    span.log(input=task_args[0], output=output)
                root_span.log(output=output, metadata=metadata)

                # First, resolve the scorers if they are classes
                scorers = [
                    scorer() if inspect.isclass(scorer) and issubclass(scorer, Scorer) else scorer
                    for scorer in evaluator.scores
                ]
                scorer_names = [_scorer_name(scorer, i) for i, scorer in enumerate(scorers)]
                score_promises = [
                    asyncio.create_task(await_or_run_scorer(root_span, score, name, **datum.as_dict(), output=output))
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

                if failing_scorers_and_exceptions:
                    scorer_errors = {
                        scorer_name: exc_info for scorer_name, _, exc_info in failing_scorers_and_exceptions
                    }
                    metadata["scorer_errors"] = scorer_errors
                    root_span.log(metadata=metadata)
                    names = ", ".join(scorer_errors.keys())
                    exceptions = [x[1] for x in failing_scorers_and_exceptions]
                    raise exceptiongroup.ExceptionGroup(
                        f"Found exceptions for the following scorers: {names}", exceptions
                    )
            except Exception as e:
                error = e
                # Python3.10 has a different set of arguments to format_exception than earlier versions,
                # so just capture the stack trace here.
                exc_info = traceback.format_exc()

        return EvalResult(
            input=datum.input,
            expected=datum.expected,
            metadata=metadata,
            tags=datum.tags,
            output=output,
            scores=scores,
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
        base_experiment = experiment.fetch_base_experiment()
        data_iterator = _init_experiment(
            project=evaluator.project_name, experiment=base_experiment.name, open=True, set_current=False
        ).as_dataset()

    if inspect.isfunction(data_iterator):
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

    tasks = []
    with async_tqdm(
        filtered_iterator(data_iterator),
        desc=f"{evaluator.eval_name} (data)",
        position=position,
        disable=position is None,
    ) as pbar:
        async for datum in pbar:
            for _ in range(evaluator.trial_count):
                tasks.append(asyncio.create_task(run_evaluator_task(datum)))

    results = []
    for task in std_tqdm(tasks, desc=f"{evaluator.eval_name} (tasks)", position=position, disable=position is None):
        results.append(await task)

    if experiment:
        summary = experiment.summarize()
    else:
        summary = build_local_summary(evaluator, results)

    return EvalResultWithSummary(results=results, summary=summary)


def build_local_summary(evaluator, results):
    scores_by_name = defaultdict(lambda: (0, 0))
    for result in results:
        for name, score in result.scores.items():
            curr = scores_by_name[name]
            if curr is None:
                continue
            scores_by_name[name] = (curr[0] + score, curr[1] + 1)
    longest_score_name = max(len(name) for name in scores_by_name) if scores_by_name else 0
    avg_scores = {
        name: ScoreSummary(
            name=name,
            score=total / count,
            diff=None,
            improvements=None,
            regressions=None,
            _longest_score_name=longest_score_name,
        )
        for name, (total, count) in scores_by_name.items()
    }
    return ExperimentSummary(
        experiment_name=evaluator.experiment_name,
        project_name=evaluator.project_name,
        project_url=None,
        experiment_url=None,
        comparison_experiment_name=None,
        scores=avg_scores,
        metrics={},
    )


__all__ = ["Evaluator", "Eval", "Score", "EvalCase", "EvalHooks", "BaseExperiment", "Reporter"]
