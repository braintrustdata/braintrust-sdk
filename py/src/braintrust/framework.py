import abc
import asyncio
import dataclasses
import inspect
import json
import re
import traceback
from collections import defaultdict
from contextlib import contextmanager
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Iterator, List, Optional, TypeVar, Union

from tqdm.asyncio import tqdm as async_tqdm
from tqdm.auto import tqdm as std_tqdm

from autoevals import Score, Scorer

from .logger import NOOP_SPAN, Span, current_span, start_span
from .logger import init as _init_experiment
from .util import SerializableDataClass

Metadata = Dict[str, Any]
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
    output and metadata.
    """

    input: Input
    expected: Optional[Output] = None
    metadata: Optional[Metadata] = None


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


EvalScorer = Union[
    Scorer,
    Callable[[Input, Output, Output], Score],
    Callable[[Input, Output, Output], Awaitable[Score]],
]


@dataclasses.dataclass
class EvalMetadata(SerializableDataClass):
    """
    Additional metadata for the eval definition, such as experiment name.
    """

    """
    Specify a name for the experiment holding the eval results.
    """
    experiment_name: Optional[str] = None


def eval_metadata_to_init_options(metadata: Optional[EvalMetadata] = None) -> Dict:
    if metadata is None:
        return dict()
    return dict(experiment=metadata.experiment_name)


@dataclasses.dataclass
class Evaluator:
    """
    An evaluator is an abstraction that defines an evaluation dataset, a task to run on the dataset, and a set of
    scorers to evaluate the results of the task. Each method attribute can be synchronous or asynchronous (for
    optimal performance, it is recommended to provide asynchronous implementations).

    You should not create Evaluators directly if you plan to use the Braintrust eval framework. Instead, you should
    create them using the `Eval()` method, which will register them so that `braintrust eval ...` can find them.
    """

    """
    The name of the project the eval falls under.
    """
    project_name: str

    """
    A name that uniquely defines this type of experiment. You do not need to change it each time the experiment runs, but you should not have other experiments in your code with the same name.
    """
    eval_name: str

    """
    Returns an iterator over the evaluation dataset. Each element of the iterator should be an `EvalCase` or a dict
    with the same fields as an `EvalCase` (`input`, `expected`, `metadata`).
    """
    data: Union[
        Iterator[EvalCase],
        Awaitable[Iterator[EvalCase]],
        Callable[[], Union[Iterator[EvalCase], Awaitable[Iterator[EvalCase]]]],
    ]

    """
    Runs the evaluation task on a single input. The `hooks` object can be used to add metadata to the evaluation.
    """
    task: Union[
        Callable[[Input, EvalHooks], Union[Output, Awaitable[Output]]],
        Callable[[Input], Union[Output, Awaitable[Output]]],
    ]

    """
    A list of scorers to evaluate the results of the task. Each scorer can be a Scorer object or a function
    that takes `input`, `output`, and `expected` arguments and returns a `Score` object. The function can be async.
    """
    scores: List[EvalScorer]

    """
    Optional additional metadata for the eval definition, such as experiment name.
    """
    metadata: Optional[EvalMetadata]


_evals = {}
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


def report_evaluator_result(eval_name, results, summary, verbose):
    failing_results = [x for x in results if x.error]
    if len(failing_results) > 0:
        print(
            f"{bcolors.FAIL}Evaluator {eval_name} failed with {len(failing_results)} {pluralize(len(failing_results), 'error', 'errors')}{bcolors.ENDC}"
        )

        for result in failing_results:
            info = "".join(
                result.exc_info if verbose else traceback.format_exception_only(type(result.error), result.error)
            ).rstrip()
            print(f"{bcolors.FAIL}{info}{bcolors.ENDC}")
    if summary:
        print(f"{summary}")
    else:
        scores_by_name = defaultdict(lambda: (0, 0))
        for result in results:
            for name, score in result.scores.items():
                curr = scores_by_name[name]
                scores_by_name[name] = (curr[0] + score, curr[1] + 1)

        print(f"Average scores for {eval_name}:")
        for name, (total, count) in scores_by_name.items():
            print(f"  {name}: {total / count}")


def _make_eval_name(name: str, metadata: Optional[EvalMetadata]):
    out = name
    if metadata is not None and metadata.experiment_name is not None:
        out += f" [experiment_name={metadata.experiment_name}]"
    return out


def Eval(
    name: str,
    data: Callable[[], Union[Iterator[EvalCase], AsyncIterator[EvalCase]]],
    task: Callable[[Input, EvalHooks], Union[Output, Awaitable[Output]]],
    scores: List[EvalScorer],
    metadata: Union[Optional[EvalMetadata], Dict] = None,
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

    :param name: The name of the evaluator. This corresponds to a project name in Braintrust.
    :param data: Returns an iterator over the evaluation dataset. Each element of the iterator should be a `EvalCase`.
    :param task: Runs the evaluation task on a single input. The `hooks` object can be used to add metadata to the evaluation.
    :param scores: A list of scorers to evaluate the results of the task. Each scorer can be a Scorer object or a function
    that takes an `EvalScorerArgs` object and returns a `Score` object.
    :param metadata: Optional additional metadata for the eval definition, such as experiment name.
    :return: An `Evaluator` object.
    """
    if isinstance(metadata, dict):
        metadata = EvalMetadata(**metadata)

    eval_name = _make_eval_name(name, metadata)

    global _evals
    if eval_name in _evals:
        raise ValueError(f"Evaluator {eval_name} already exists")

    evaluator = Evaluator(
        eval_name=eval_name, project_name=name, data=data, task=task, scores=scores, metadata=metadata
    )

    if _lazy_load:
        _evals[eval_name] = evaluator
    else:
        # https://stackoverflow.com/questions/55409641/asyncio-run-cannot-be-called-from-a-running-event-loop-when-using-jupyter-no
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # 'RuntimeError: There is no current event loop...'
            loop = None

        async def run_to_completion():
            with init_experiment(evaluator.project_name, evaluator.metadata) as experiment:
                results, summary = await run_evaluator(experiment, evaluator, 0, [])
                report_evaluator_result(evaluator.eval_name, results, summary, True)

        if loop:
            return loop.create_task(run_to_completion())
        else:
            asyncio.run(run_to_completion())


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


@dataclasses.dataclass
class EvalResult:
    output: Output
    metadata: Metadata
    scores: Dict[str, Score]
    error: Optional[Exception] = None
    exc_info: Optional[str] = None


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


def init_experiment(project_name, metadata):
    ret = _init_experiment(project_name, **eval_metadata_to_init_options(metadata))
    summary = ret.summarize(summarize_scores=False)
    print(f"Experiment {ret.name} is running at {summary.experiment_url}")
    return ret


async def run_evaluator(experiment, evaluator: Evaluator, position: Optional[int], filters: List[Filter]):
    #   if (typeof evaluator.data === "string") {
    #     throw new Error("Unimplemented: string data paths");
    #   }
    #   const dataResult = evaluator.data();
    #   let data = null;
    #   if (dataResult instanceof Promise) {
    #     data = await dataResult;
    #   } else {
    #     data = dataResult;
    #   }

    async def await_or_run(f, *args, **kwargs):
        if inspect.iscoroutinefunction(f):
            return await f(*args, **kwargs)
        else:
            return f(*args, **kwargs)

    async def await_or_run_scorer(scorer, scorer_idx, **kwargs):
        name = scorer._name() if hasattr(scorer, "_name") else scorer.__name__
        if name == "<lambda>":
            name = f"scorer_{scorer_idx}"
        with start_span(name=name, input=dict(**kwargs)):
            score = scorer.eval_async if isinstance(scorer, Scorer) else scorer

            scorer_args = kwargs

            signature = inspect.signature(score)
            scorer_accepts_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values())
            if not scorer_accepts_kwargs:
                scorer_args = {k: v for k, v in scorer_args.items() if k in signature.parameters}

            result = await await_or_run(score, **scorer_args)
            if isinstance(result, Score):
                result_rest = result.as_dict()
                result_metadata = result_rest.pop("metadata", {})
                current_span().log(output=result_rest, metadata=result_metadata)
            else:
                current_span().log(output=result)
            return result

    async def run_evaluator_task(datum):
        if isinstance(datum, dict):
            datum = EvalCase(**datum)

        metadata = {**(datum.metadata or {})}
        output = None
        error = None
        exc_info = None
        scores = {}

        if experiment:
            root_span = experiment.start_span("eval", input=datum.input, expected=datum.expected)
        else:
            root_span = NOOP_SPAN
        with root_span:
            try:
                hooks = DictEvalHooks(metadata)

                # Check if the task takes a hooks argument
                task_args = [datum.input]
                if len(inspect.signature(evaluator.task).parameters) == 2:
                    task_args.append(hooks)

                with current_span().start_span("task") as task_span:
                    hooks.set_span(task_span)
                    output = await await_or_run(evaluator.task, *task_args)
                    task_span.log(input=task_args[0], output=output)
                current_span().log(output=output)

                # First, resolve the scorers if they are classes
                scorers = [
                    scorer() if inspect.isclass(scorer) and issubclass(scorer, Scorer) else scorer
                    for scorer in evaluator.scores
                ]
                score_promises = [
                    asyncio.create_task(await_or_run_scorer(score, idx, **datum.as_dict(), output=output))
                    for idx, score in enumerate(scorers)
                ]
                score_results = [await p for p in score_promises]
                score_metadata = {}
                for scorer, score_result in zip(scorers, score_results):
                    if not isinstance(score_result, Score):
                        score_result = Score(name=scorer.__name__, score=score_result)
                    scores[score_result.name] = score_result.score
                    m = {**(score_result.metadata or {})}
                    if score_result.error is not None:
                        m["error"] = str(score_result.error)
                    if len(m) > 0:
                        score_metadata[score_result.name] = m

                if len(score_metadata) > 0:
                    hooks.meta(scores=score_metadata)

                # XXX: We could probably log these as they are being produced
                current_span().log(metadata=metadata, scores=scores)
            except Exception as e:
                error = e
                # Python3.10 has a different set of arguments to format_exception than earlier versions,
                # so just capture the stack trace here.
                exc_info = traceback.format_exc()

        return EvalResult(output=output, metadata=metadata, scores=scores, error=error, exc_info=exc_info)

    data_iterator = evaluator.data
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
            tasks.append(asyncio.create_task(run_evaluator_task(datum)))

    results = []
    for task in std_tqdm(tasks, desc=f"{evaluator.eval_name} (tasks)", position=position, disable=position is None):
        results.append(await task)

    summary = experiment.summarize() if experiment else None
    return results, summary


__all__ = ["Evaluator", "Eval", "Score", "EvalCase", "EvalHooks"]
