"""
Braintrust integration for LangSmith - provides a migration path from LangSmith to Braintrust.

This module patches LangSmith's tracing and evaluation APIs to use Braintrust under the hood,
allowing users to migrate with minimal code changes.

Usage:
    ```python
    from braintrust.wrappers.langsmith import setup_langsmith

    # Call setup BEFORE importing from langsmith
    setup_langsmith(project="my-project")

    # Continue using langsmith imports - they now use Braintrust
    from langsmith import traceable, Client

    @traceable
    def my_function(x: int) -> int:
        return x * 2

    client = Client()
    results = client.evaluate(
        my_function,
        data=[{"inputs": {"x": 1}, "outputs": {"result": 2}}],
        evaluators=[my_evaluator],
    )
    ```
"""

import functools
import inspect
import logging
from typing import Any, Callable, Dict, List, Optional, TypeVar, Union

from braintrust.logger import NOOP_SPAN, current_span, init_logger, traced
from wrapt import wrap_function_wrapper

logger = logging.getLogger(__name__)

__all__ = ["setup_langsmith", "wrap_traceable", "wrap_client", "wrap_aevaluate"]

F = TypeVar("F", bound=Callable[..., Any])


def setup_langsmith(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project: Optional[str] = None,
    standalone: bool = False,
) -> bool:
    """
    Setup Braintrust integration with LangSmith.

    This patches LangSmith's @traceable, Client.evaluate(), and aevaluate()
    to use Braintrust.

    Args:
        api_key: Braintrust API key (optional, can use env var BRAINTRUST_API_KEY)
        project_id: Braintrust project ID (optional)
        project: Braintrust project name (optional, can use env var BRAINTRUST_PROJECT)
        standalone: If True, completely replace LangSmith with Braintrust (no LangSmith
                   code runs). If False (default), add Braintrust tracing alongside
                   LangSmith for @traceable, but replace evaluate() with Braintrust's Eval.

    Returns:
        True if setup was successful, False otherwise
    """
    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project, api_key=api_key, project_id=project_id)

    try:
        import langsmith
        from langsmith import Client

        wrap_traceable(langsmith, standalone=standalone)
        wrap_client(Client, standalone=standalone)
        wrap_aevaluate(langsmith, standalone=standalone)

        logger.info("LangSmith integration with Braintrust enabled")
        return True

    except ImportError as e:
        logger.error(f"Failed to import langsmith: {e}")
        logger.error("langsmith is not installed. Please install it with: pip install langsmith")
        return False


def wrap_traceable(langsmith_module: Any, standalone: bool = False) -> Any:
    """
    Wrap langsmith.traceable to also use Braintrust's @traced decorator.

    Args:
        langsmith_module: The langsmith module
        standalone: If True, replace LangSmith tracing entirely with Braintrust.
                   If False, add Braintrust tracing alongside LangSmith tracing.

    Returns:
        The langsmith module (modified in place)
    """
    if _is_patched(langsmith_module, "traceable"):
        return langsmith_module

    if standalone:
        langsmith_module.traceable = _braintrust_traceable
    else:
        wrap_function_wrapper(langsmith_module, "traceable", _traceable_wrapper)

    langsmith_module._braintrust_traceable_patched = True
    return langsmith_module


def wrap_client(Client: Any, standalone: bool = False) -> Any:
    """
    Wrap langsmith.Client to redirect evaluate() to Braintrust's Eval.

    Args:
        Client: The langsmith.Client class
        standalone: Ignored (evaluate is always redirected to Braintrust)

    Returns:
        The Client class (modified in place)
    """
    if _is_patched(Client, "evaluate"):
        return Client

    wrap_function_wrapper(Client, "evaluate", _evaluate_wrapper)
    Client._braintrust_evaluate_patched = True
    return Client


def wrap_aevaluate(langsmith_module: Any, standalone: bool = False) -> Any:
    """
    Wrap langsmith.aevaluate to redirect to Braintrust's EvalAsync.

    Args:
        langsmith_module: The langsmith module
        standalone: Ignored (aevaluate is always redirected to Braintrust)

    Returns:
        The langsmith module (modified in place)
    """
    if not hasattr(langsmith_module, "aevaluate"):
        return langsmith_module

    if _is_patched(langsmith_module, "aevaluate"):
        return langsmith_module

    wrap_function_wrapper(langsmith_module, "aevaluate", _aevaluate_wrapper)
    langsmith_module._braintrust_aevaluate_patched = True
    return langsmith_module


def _is_patched(obj: Any, feature: str) -> bool:
    return getattr(obj, f"_braintrust_{feature}_patched", False)


# =============================================================================
# Wrapping implementations (call original + add Braintrust)
# =============================================================================


def _traceable_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any) -> Any:
    """
    Wrapper that calls original LangSmith traceable AND adds Braintrust tracing.
    """
    name = kwargs.get("name")
    func = args[0] if args else None

    # Call original LangSmith traceable
    result = wrapped(*args, **kwargs)

    # Wrap with Braintrust traced
    if func is not None:
        # @traceable was called with a function directly
        return traced(name=name or func.__name__)(result)
    else:
        # @traceable() was called with kwargs, returns a decorator
        def decorator(fn: F) -> F:
            decorated = result(fn)
            return traced(name=name or fn.__name__)(decorated)
        return decorator


# =============================================================================
# Standalone implementations (Braintrust only, no LangSmith)
# =============================================================================


def _braintrust_traceable(
    func: Optional[F] = None,
    *,
    run_type: str = "chain",
    name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    tags: Optional[List[str]] = None,
    client: Any = None,
    project_name: Optional[str] = None,
    **kwargs: Any,
) -> Union[F, Callable[[F], F]]:
    """Braintrust implementation of @traceable using @traced."""

    def decorator(fn: F) -> F:
        span_name = name or fn.__name__

        @traced(name=span_name)
        @functools.wraps(fn)
        def inner(*inner_args: Any, **inner_kwargs: Any) -> Any:
            span = current_span()
            if span and span != NOOP_SPAN:
                if metadata:
                    span.log(metadata={"langsmith_metadata": metadata, "run_type": run_type})
                if tags:
                    span.log(tags=tags)
            return fn(*inner_args, **inner_kwargs)

        return inner  # type: ignore

    if func is not None:
        return decorator(func)
    return decorator


def _evaluate_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any) -> Any:
    """Wrapper for Client.evaluate that redirects to Braintrust's Eval."""
    return _run_braintrust_eval(args, kwargs)


async def _aevaluate_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any) -> Any:
    """Wrapper for aevaluate that redirects to Braintrust's EvalAsync."""
    return await _run_braintrust_eval_async(args, kwargs)


# =============================================================================
# Shared Braintrust evaluation logic
# =============================================================================


def _run_braintrust_eval(args: Any, kwargs: Any) -> Any:
    """Run Braintrust Eval with LangSmith-style arguments."""
    from braintrust.framework import Eval

    target = args[0] if args else kwargs.get("target")
    data = args[1] if len(args) > 1 else kwargs.get("data")
    evaluators = kwargs.get("evaluators")
    experiment_prefix = kwargs.get("experiment_prefix")
    description = kwargs.get("description")
    metadata = kwargs.get("metadata")
    max_concurrency = kwargs.get("max_concurrency")
    num_repetitions = kwargs.get("num_repetitions", 1)

    project_name = experiment_prefix or "langsmith-migration"

    return Eval(
        name=project_name,
        data=_convert_langsmith_data(data),
        task=_make_braintrust_task(target),
        scores=[_convert_langsmith_evaluator(e) for e in evaluators] if evaluators else [],
        experiment_name=experiment_prefix,
        description=description,
        metadata=metadata,
        max_concurrency=max_concurrency,
        trial_count=num_repetitions,
    )


async def _run_braintrust_eval_async(args: Any, kwargs: Any) -> Any:
    """Run Braintrust EvalAsync with LangSmith-style arguments."""
    from braintrust.framework import EvalAsync

    target = args[0] if args else kwargs.get("target")
    data = args[1] if len(args) > 1 else kwargs.get("data")
    evaluators = kwargs.get("evaluators")
    experiment_prefix = kwargs.get("experiment_prefix")
    description = kwargs.get("description")
    metadata = kwargs.get("metadata")
    max_concurrency = kwargs.get("max_concurrency")
    num_repetitions = kwargs.get("num_repetitions", 1)

    project_name = experiment_prefix or "langsmith-migration"

    return await EvalAsync(
        name=project_name,
        data=_convert_langsmith_data(data),
        task=_make_braintrust_task(target),
        scores=[_convert_langsmith_evaluator(e) for e in evaluators] if evaluators else [],
        experiment_name=experiment_prefix,
        description=description,
        metadata=metadata,
        max_concurrency=max_concurrency,
        trial_count=num_repetitions,
    )


# =============================================================================
# Data conversion helpers
# =============================================================================


def _convert_langsmith_evaluator(evaluator: Callable[..., Any]) -> Callable[..., Any]:
    """
    Convert a LangSmith-style evaluator to Braintrust scorer format.

    LangSmith evaluators: (run: Run, example: Example) -> EvaluationResult
    Braintrust scorers: (input, output, expected=None, **kwargs) -> Score
    """

    @functools.wraps(evaluator)
    def braintrust_scorer(
        task_input: Any, output: Any, expected: Optional[Any] = None, **kwargs: Any
    ) -> Any:
        from braintrust.score import Score

        class MockRun:
            def __init__(self, outputs: Any):
                self.outputs = outputs

        class MockExample:
            def __init__(self, inputs: Any, outputs: Optional[Any]):
                self.inputs = inputs
                self.outputs = outputs

        run = MockRun(outputs=output)
        example = MockExample(inputs=task_input, outputs=expected)

        try:
            result = evaluator(run, example)
        except TypeError:
            try:
                result = evaluator(output, expected)
            except TypeError:
                result = evaluator(output)

        if result is None:
            return Score(name=getattr(evaluator, "__name__", "score"), score=None)

        if isinstance(result, dict):
            score_value = result.get("score", result.get("value"))
            score_name = result.get("key", result.get("name", getattr(evaluator, "__name__", "score")))
            return Score(
                name=score_name,
                score=float(score_value) if score_value is not None else None,
                metadata=result.get("metadata"),
            )

        if isinstance(result, (int, float, bool)):
            return Score(
                name=getattr(evaluator, "__name__", "score"),
                score=float(result),
            )

        if hasattr(result, "score") and hasattr(result, "key"):
            return Score(
                name=result.key,
                score=float(result.score) if result.score is not None else None,
                metadata=getattr(result, "metadata", None),
            )

        return result

    return braintrust_scorer


def _convert_langsmith_data(data: Any) -> Callable[[], List[Dict[str, Any]]]:
    """Convert LangSmith data format to Braintrust data format."""
    from braintrust.framework import EvalCase

    def load_data() -> List[Dict[str, Any]]:
        raw_data: List[Any] = []

        if callable(data):
            raw_data = list(data())
        elif isinstance(data, str):
            logger.warning(
                f"Dataset name '{data}' passed to evaluate(). "
                "Braintrust doesn't support loading LangSmith datasets by name. "
                "Please pass the data directly."
            )
            return []
        elif hasattr(data, "__iter__"):
            raw_data = list(data)
        else:
            raw_data = [data]

        eval_cases = []
        for item in raw_data:
            if isinstance(item, dict):
                inputs = item.get("inputs", item.get("input", item))
                outputs = item.get("outputs", item.get("expected"))
                eval_cases.append(
                    EvalCase(
                        input=inputs,
                        expected=outputs,
                        metadata=item.get("metadata"),
                    )
                )
            elif hasattr(item, "inputs"):
                eval_cases.append(
                    EvalCase(
                        input=item.inputs,
                        expected=getattr(item, "outputs", None),
                        metadata=getattr(item, "metadata", None),
                    )
                )
            else:
                eval_cases.append(EvalCase(input=item))

        return eval_cases

    return load_data


def _make_braintrust_task(target: Callable[..., Any]) -> Callable[..., Any]:
    """Convert a LangSmith target function to Braintrust task format."""

    def task_fn(task_input: Any, hooks: Any) -> Any:
        if isinstance(task_input, dict):
            try:
                sig = inspect.signature(target)
                params = list(sig.parameters.keys())
                if len(params) == 1:
                    return target(task_input)
                if all(p in task_input for p in params):
                    return target(**task_input)
                return target(task_input)
            except (ValueError, TypeError):
                return target(task_input)
        return target(task_input)

    return task_fn
