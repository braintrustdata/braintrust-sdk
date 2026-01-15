"""
Braintrust integration for LangSmith - provides a migration path from LangSmith to Braintrust.

This module patches LangSmith's tracing and evaluation APIs to use Braintrust under the hood,
allowing users to migrate with minimal code changes.

Usage:
    ```python
    import os

    # Enable LangSmith tracing and set project name (used by both services)
    os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
    os.environ.setdefault("LANGCHAIN_PROJECT", "my-project")

    from braintrust.wrappers.langsmith_wrapper import setup_langsmith

    # Call setup BEFORE importing from langsmith
    # project_name defaults to LANGCHAIN_PROJECT env var
    setup_langsmith()

    # Continue using langsmith imports - they now use Braintrust
    from langsmith import traceable, Client

    @traceable
    def my_function(inputs: dict) -> dict:
        return {"result": inputs["x"] * 2}

    client = Client()
    results = client.evaluate(
        my_function,
        data=[{"inputs": {"x": 1}, "outputs": {"result": 2}}],
        evaluators=[my_evaluator],
    )
    ```

    Set BRAINTRUST_STANDALONE=1 to completely replace LangSmith with Braintrust
    (no LangSmith code runs). Otherwise, both services run in tandem.
"""

import inspect
import logging
import os
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional, ParamSpec, TypeVar

from braintrust.framework import EvalCase
from braintrust.logger import NOOP_SPAN, current_span, init_logger, traced
from wrapt import wrap_function_wrapper

logger = logging.getLogger(__name__)

# Global list to store Braintrust eval results when running in tandem mode
_braintrust_eval_results: List[Any] = []

# TODO: langsmith.test/unit/expect, langsmith.AsyncClient, trace
__all__ = [
    "setup_langsmith",
    "wrap_traceable",
    "wrap_client",
    "wrap_evaluate",
    "wrap_aevaluate",
    "get_braintrust_results",
    "clear_braintrust_results",
]

F = TypeVar("F", bound=Callable[..., Any])
P = ParamSpec("P")
R = TypeVar("R")


def get_braintrust_results() -> List[Any]:
    """Get all Braintrust eval results collected during tandem mode."""
    return _braintrust_eval_results.copy()


def clear_braintrust_results() -> None:
    """Clear all stored Braintrust eval results."""
    _braintrust_eval_results.clear()


def setup_langsmith(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
    standalone: bool = False,
) -> bool:
    """
    Setup Braintrust integration with LangSmith.

    This patches LangSmith's @traceable, Client.evaluate(), and aevaluate()
    to use Braintrust under the hood.

    Args:
        api_key: Braintrust API key (optional, can use env var BRAINTRUST_API_KEY)
        project_id: Braintrust project ID (optional)
        project_name: Braintrust project name (optional, falls back to LANGCHAIN_PROJECT
                     env var, then BRAINTRUST_PROJECT env var)
        standalone: If True, completely replace LangSmith with Braintrust (no LangSmith
                   code runs). If False (default), run both LangSmith and Braintrust
                   in tandem.

    Returns:
        True if setup was successful, False otherwise
    """
    # Use LANGCHAIN_PROJECT as fallback for project_name to keep both services in sync
    if project_name is None:
        project_name = os.environ.get("LANGCHAIN_PROJECT")

    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project_name, api_key=api_key, project_id=project_id)

    try:
        import langsmith

        langsmith.traceable = wrap_traceable(langsmith.traceable, standalone=standalone)
        wrap_client(langsmith.Client, project_name=project_name, project_id=project_id, standalone=standalone)
        langsmith.evaluate = wrap_evaluate(
            langsmith.evaluate, project_name=project_name, project_id=project_id, standalone=standalone
        )
        langsmith.aevaluate = wrap_aevaluate(
            langsmith.aevaluate, project_name=project_name, project_id=project_id, standalone=standalone
        )

        logger.info("LangSmith integration with Braintrust enabled")
        return True

    except ImportError as e:
        logger.error(f"Failed to import langsmith: {e}")
        logger.error("langsmith is not installed. Please install it with: pip install langsmith")
        return False


def wrap_traceable(traceable: F, standalone: bool = False) -> F:
    """
    Wrap langsmith.traceable to also use Braintrust's @traced decorator.

    Args:
        traceable: The langsmith.traceable function
        standalone: If True, replace LangSmith tracing entirely with Braintrust.
                   If False, add Braintrust tracing alongside LangSmith tracing.

    Returns:
        The wrapped traceable function (or the original if already patched)
    """
    if _is_patched(traceable):
        return traceable

    def traceable_wrapper(*args: Any, **kwargs: Any) -> Any:
        # Handle both @traceable and @traceable(...) patterns
        func = args[0] if args and callable(args[0]) else None

        def decorator(fn: Callable[P, R]) -> Callable[P, R]:
            span_name = kwargs.get("name") or fn.__name__

            # Conditionally apply LangSmith decorator first
            if not standalone:
                fn = traceable(fn, **kwargs)

            # Always apply Braintrust tracing
            return traced(name=span_name)(fn)  # type: ignore[return-value]

        if func is not None:
            return decorator(func)
        return decorator

    traceable_wrapper._braintrust_patched = True  # type: ignore[attr-defined]
    return traceable_wrapper  # type: ignore[return-value]


def wrap_client(
    Client: Any, project_name: Optional[str] = None, project_id: Optional[str] = None, standalone: bool = False
) -> Any:
    """
    Wrap langsmith.Client to redirect evaluate() and aevaluate() to Braintrust's Eval.

    Args:
        Client: The langsmith.Client class
        project_name: Braintrust project name to use for evaluations
        project_id: Braintrust project ID to use for evaluations
        standalone: If True, only run Braintrust. If False, run both LangSmith and Braintrust.

    Returns:
        The Client class (modified in place)
    """

    if hasattr(Client, "evaluate") and not _is_patched(Client.evaluate):
        wrap_function_wrapper(
            Client,
            "evaluate",
            make_evaluate_wrapper(standalone=standalone, project_name=project_name, project_id=project_id),
        )
        Client.evaluate._braintrust_patched = True  # type: ignore[attr-defined]

    if hasattr(Client, "aevaluate") and not _is_patched(Client.aevaluate):
        wrap_function_wrapper(
            Client,
            "aevaluate",
            make_aevaluate_wrapper(standalone=standalone, project_name=project_name, project_id=project_id),
        )
        Client.aevaluate._braintrust_patched = True  # type: ignore[attr-defined]

    return Client


def make_evaluate_wrapper(
    *, project_name: Optional[str] = None, project_id: Optional[str] = None, standalone: bool = False
):
    def evaluate_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any) -> Any:
        result = None
        if not standalone:
            result = wrapped(*args, **kwargs)

        try:
            result = _run_braintrust_eval(
                args,
                kwargs,
                project_name,
                project_id,
            )
            _braintrust_eval_results.append(result)
        except Exception as e:
            if standalone:
                raise e
            else:
                logger.warning(f"Braintrust evaluate failed: {e}")

        return result

    return evaluate_wrapper


def make_aevaluate_wrapper(
    *, project_name: Optional[str] = None, project_id: Optional[str] = None, standalone: bool = False
):
    async def aevaluate_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any) -> Any:
        result = None
        if not standalone:
            result = await wrapped(*args, **kwargs)

        try:
            result = await _run_braintrust_eval_async(
                args,
                kwargs,
                project_name,
                project_id,
            )
            _braintrust_eval_results.append(result)
        except Exception as e:
            if standalone:
                raise e
            else:
                logger.warning(f"Braintrust aevaluate failed: {e}")

        return result

    return aevaluate_wrapper


def wrap_evaluate(
    evaluate: F, project_name: Optional[str] = None, project_id: Optional[str] = None, standalone: bool = False
) -> F:
    """
    Wrap module-level langsmith.evaluate to redirect to Braintrust's Eval.

    Args:
        evaluate: The langsmith.evaluate function
        project_name: Braintrust project name to use for evaluations
        project_id: Braintrust project ID to use for evaluations
        standalone: If True, only run Braintrust. If False, run both LangSmith and Braintrust.

    Returns:
        The wrapped evaluate function (or the original if already patched)
    """
    if _is_patched(evaluate):
        return evaluate

    evaluate_wrapper = make_evaluate_wrapper(standalone=standalone, project_name=project_name, project_id=project_id)
    evaluate_wrapper._braintrust_patched = True  # type: ignore[attr-defined]
    return evaluate_wrapper  # type: ignore[return-value]


def wrap_aevaluate(
    aevaluate: F,
    project_name: Optional[str] = None,
    project_id: Optional[str] = None,
    standalone: bool = False,
) -> F:
    """
    Wrap module-level langsmith.aevaluate to redirect to Braintrust's EvalAsync.

    Args:
        aevaluate: The langsmith.aevaluate function
        project_name: Braintrust project name to use for evaluations
        project_id: Braintrust project ID to use for evaluations
        standalone: If True, only run Braintrust. If False, run both LangSmith and Braintrust.

    Returns:
        The wrapped aevaluate function (or the original if already patched)
    """
    if _is_patched(aevaluate):
        return aevaluate

    aevaluate_wrapper = make_aevaluate_wrapper(standalone=standalone, project_name=project_name, project_id=project_id)
    aevaluate_wrapper._braintrust_patched = True  # type: ignore[attr-defined]
    return aevaluate_wrapper  # type: ignore[return-value]


def _is_patched(obj: Any) -> bool:
    return getattr(obj, "_braintrust_patched", False)


# =============================================================================
# Braintrust evaluation logic
# =============================================================================


def _run_braintrust_eval(
    args: Any,
    kwargs: Any,
    project_name: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Any:
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

    # Convert evaluators to scorers
    scorers = []
    if evaluators:
        for e in evaluators:
            scorers.append(_make_braintrust_scorer(e))

    return Eval(
        name=project_name or "langsmith-migration",
        data=_convert_langsmith_data(data),
        task=_make_braintrust_task(target),
        scores=scorers,
        experiment_name=experiment_prefix,
        project_id=project_id,
        description=description,
        metadata=metadata,
        max_concurrency=max_concurrency,
        trial_count=num_repetitions,
    )


async def _run_braintrust_eval_async(
    args: Any,
    kwargs: Any,
    project_name: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Any:
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

    # Convert evaluators to scorers
    scorers = []
    if evaluators:
        for e in evaluators:
            scorers.append(_make_braintrust_scorer(e))

    return await EvalAsync(
        name=project_name or "langsmith-migration",
        data=_convert_langsmith_data(data),
        task=_make_braintrust_task(target),
        scores=scorers,
        experiment_name=experiment_prefix,
        project_id=project_id,
        description=description,
        metadata=metadata,
        max_concurrency=max_concurrency,
        trial_count=num_repetitions,
    )


# =============================================================================
# Data conversion helpers
# =============================================================================


def _wrap_output(output: Any) -> Dict[str, Any]:
    """Wrap non-dict outputs the same way LangSmith does."""
    if not isinstance(output, dict):
        return {"output": output}
    return output


def _make_braintrust_scorer(
    evaluator: Callable[..., Any],
) -> Callable[..., Any]:
    """
    Create a Braintrust scorer from a LangSmith evaluator.

    Always runs the evaluator through Braintrust for full tracing (span duration, child LLM calls, etc.).
    """
    evaluator_name = getattr(evaluator, "__name__", "score")

    def braintrust_scorer(input: Any, output: Any, expected: Optional[Any] = None, **kwargs: Any) -> Any:
        from braintrust.score import Score

        # Run the evaluator with LangSmith's signature
        # LangSmith evaluators use: (inputs, outputs, reference_outputs) -> bool | dict
        # LangSmith auto-wraps non-dict outputs as {"output": value}
        outputs = _wrap_output(output)

        # expected is the real LangSmith Example object passed through from data loading
        reference_outputs = expected.outputs if hasattr(expected, "outputs") else expected

        result = evaluator(input, outputs, reference_outputs)

        return Score(
            name=result.get("key", evaluator_name),
            score=result.get("score"),
            metadata=result.get("metadata", {}),
        )

    braintrust_scorer.__name__ = evaluator_name
    return braintrust_scorer


def _convert_langsmith_data(data: Any) -> Callable[[], Iterator[EvalCase[Any, Any]]]:
    """Convert LangSmith data format to Braintrust data format."""

    def load_data() -> Iterator[EvalCase[Any, Any]]:
        # Determine the source iterable without loading everything into memory
        source: Iterable[Any]
        if callable(data):
            source = data()  # type: ignore
        elif isinstance(data, str):
            # Load examples from LangSmith dataset by name
            try:
                from langsmith import Client  # pylint: disable=import-error

                client = Client()
                source = client.list_examples(dataset_name=data)
            except Exception as e:
                logger.warning(f"Failed to load LangSmith dataset '{data}': {e}")
                return
        elif hasattr(data, "__iter__"):
            source = data
        else:
            source = [data]

        # Process items as a generator - yield one at a time
        for item in source:
            # Pass through LangSmith Example objects directly
            if hasattr(item, "inputs"):
                yield EvalCase(
                    input=item.inputs,
                    expected=item,  # Pass the whole Example object
                    metadata=getattr(item, "metadata", None),
                )
            elif isinstance(item, dict):
                if "inputs" in item:
                    # LangSmith dict format
                    yield EvalCase(
                        input=item["inputs"],
                        expected=item,  # Pass the whole dict
                        metadata=item.get("metadata"),
                    )
                elif "input" in item:
                    # Braintrust format
                    yield EvalCase(
                        input=item["input"],
                        expected=item.get("expected"),
                        metadata=item.get("metadata"),
                    )
                else:
                    yield EvalCase(input=item)
            else:
                yield EvalCase(input=item)

    return load_data


def _make_braintrust_task(target: Callable[..., Any]) -> Callable[..., Any]:
    """Convert a LangSmith target function to Braintrust task format."""

    def task_fn(task_input: Any, hooks: Any) -> Any:
        if isinstance(task_input, dict):
            # Try to get the original function's signature (unwrap decorators)
            unwrapped = inspect.unwrap(target)

            try:
                sig = inspect.signature(unwrapped)
                params = list(sig.parameters.keys())
                if len(params) == 1:
                    return target(task_input)
                if all(p in task_input for p in params):
                    return target(**task_input)
                return target(task_input)
            except (ValueError, TypeError):
                # Fallback: try kwargs first, then single arg
                try:
                    return target(**task_input)
                except TypeError:
                    return target(task_input)
        return target(task_input)

    return task_fn
