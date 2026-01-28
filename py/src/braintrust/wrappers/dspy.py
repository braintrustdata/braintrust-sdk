"""
Braintrust integration for DSPy.

This module provides the BraintrustDSpyCallback class for logging DSPy execution traces to Braintrust.

Basic Usage:
    ```python
    import dspy
    from braintrust import init_logger
    from braintrust.wrappers.dspy import BraintrustDSpyCallback

    # Initialize Braintrust logger
    init_logger(project="my-dspy-project")

    # Configure DSPy with Braintrust callback
    lm = dspy.LM("openai/gpt-4o-mini")
    dspy.configure(lm=lm, callbacks=[BraintrustDSpyCallback()])

    # Use DSPy as normal - all execution will be logged to Braintrust
    cot = dspy.ChainOfThought("question -> answer")
    result = cot(question="What is the capital of France?")
    ```

Advanced Usage with LiteLLM Patching:
    For more detailed token metrics and tracing, you can patch LiteLLM before importing DSPy.
    Note: You must disable DSPy's disk cache to ensure all LLM calls are traced.

    ```python
    # IMPORTANT: Patch LiteLLM BEFORE importing DSPy
    from braintrust.wrappers.litellm import patch_litellm
    patch_litellm()

    import dspy
    from braintrust import init_logger
    from braintrust.wrappers.dspy import BraintrustDSpyCallback

    logger = init_logger(project="my-project")

    # Disable disk cache to ensure LiteLLM wrapper is always called
    dspy.configure_cache(
        enable_disk_cache=False,
        enable_memory_cache=True,  # Keep memory cache for performance
    )

    lm = dspy.LM("openai/gpt-4o-mini")
    dspy.configure(lm=lm, callbacks=[BraintrustDSpyCallback()])
    ```
"""

from typing import Any

from braintrust.logger import current_span, start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

# Note: For detailed token and cost metrics, use patch_litellm() before importing DSPy.
# The DSPy callback focuses on execution flow and span hierarchy.

try:
    from dspy.utils.callback import BaseCallback
except ImportError:
    raise ImportError("DSPy is not installed. Please install it with: pip install dspy")

__all__ = ["BraintrustDSpyCallback", "patch_dspy"]


class BraintrustDSpyCallback(BaseCallback):
    """Callback handler that logs DSPy execution traces to Braintrust.

    This callback integrates DSPy with Braintrust's observability platform, automatically
    logging language model calls, module executions, tool invocations, and evaluations.

    Logged information includes:
    - Input parameters and output results
    - Execution latency
    - Error information when exceptions occur
    - Hierarchical span relationships for nested operations

    Basic Example:
        ```python
        import dspy
        from braintrust import init_logger
        from braintrust.wrappers.dspy import BraintrustDSpyCallback

        # Initialize Braintrust
        init_logger(project="dspy-example")

        # Configure DSPy with callback
        lm = dspy.LM("openai/gpt-4o-mini")
        dspy.configure(lm=lm, callbacks=[BraintrustDSpyCallback()])

        # Use DSPy - execution is automatically logged
        predictor = dspy.Predict("question -> answer")
        result = predictor(question="What is 2+2?")
        ```

    Advanced Example with LiteLLM Patching:
        For additional detailed token metrics from LiteLLM's wrapper, patch before importing DSPy
        and disable DSPy's disk cache:

        ```python
        from braintrust.wrappers.litellm import patch_litellm
        patch_litellm()

        import dspy
        from braintrust import init_logger
        from braintrust.wrappers.dspy import BraintrustDSpyCallback

        init_logger(project="dspy-example")

        # Disable disk cache to ensure LiteLLM calls are traced
        dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=True)

        lm = dspy.LM("openai/gpt-4o-mini")
        dspy.configure(lm=lm, callbacks=[BraintrustDSpyCallback()])
        ```

    The callback creates Braintrust spans for:
    - DSPy module executions (Predict, ChainOfThought, ReAct, etc.)
    - LLM calls with latency metrics
    - Tool calls
    - Evaluation runs

    For detailed token usage and cost metrics, use LiteLLM patching (see Advanced Example above).
    The patched LiteLLM wrapper will create additional "Completion" spans with comprehensive metrics.

    Spans are automatically nested based on the execution hierarchy.
    """

    def __init__(self):
        """Initialize the Braintrust DSPy callback handler."""
        super().__init__()
        # Map call_id to span objects for proper nesting
        self._spans: dict[str, Any] = {}

    def on_lm_start(
        self,
        call_id: str,
        instance: Any,
        inputs: dict[str, Any],
    ):
        """Log the start of a language model call.

        Args:
            call_id: Unique identifier for this call
            instance: The LM instance being called
            inputs: Input parameters to the LM
        """
        # Extract metadata from the LM instance and inputs
        metadata = {}
        if hasattr(instance, "model"):
            metadata["model"] = instance.model
        if hasattr(instance, "provider"):
            metadata["provider"] = str(instance.provider)

        # Extract common LM parameters from inputs
        for key in ["temperature", "max_tokens", "top_p", "top_k", "stop"]:
            if key in inputs:
                metadata[key] = inputs[key]

        # Get the current active span to establish parent-child relationship
        parent = current_span()
        parent_export = parent.export() if parent else None

        span = start_span(
            name="dspy.lm",
            input=inputs,
            metadata=metadata,
            parent=parent_export,
        )
        # Manually set as current span so children can find it
        span.set_current()
        self._spans[call_id] = span

    def on_lm_end(
        self,
        call_id: str,
        outputs: dict[str, Any] | None,
        exception: Exception | None = None,
    ):
        """Log the end of a language model call.

        Args:
            call_id: Unique identifier for this call
            outputs: Output from the LM, or None if there was an exception
            exception: Exception raised during execution, if any
        """
        span = self._spans.pop(call_id, None)
        if not span:
            return

        try:
            log_data = {}
            if exception:
                log_data["error"] = exception
            if outputs:
                log_data["output"] = outputs

            if log_data:
                span.log(**log_data)
        finally:
            span.unset_current()
            span.end()

    def on_module_start(
        self,
        call_id: str,
        instance: Any,
        inputs: dict[str, Any],
    ):
        """Log the start of a DSPy module execution.

        Args:
            call_id: Unique identifier for this call
            instance: The Module instance being called
            inputs: Input parameters to the module's forward() method
        """
        # Get module name
        module_name = instance.__class__.__name__
        if hasattr(instance, "__class__") and hasattr(instance.__class__, "__module__"):
            module_name = f"{instance.__class__.__module__}.{instance.__class__.__name__}"

        # Get the current active span to establish parent-child relationship
        parent = current_span()
        parent_export = parent.export() if parent else None

        span = start_span(
            name=f"dspy.module.{instance.__class__.__name__}",
            input=inputs,
            metadata={"module_class": module_name},
            parent=parent_export,
        )
        # Manually set as current span so children can find it
        span.set_current()
        self._spans[call_id] = span

    def on_module_end(
        self,
        call_id: str,
        outputs: Any | None,
        exception: Exception | None = None,
    ):
        """Log the end of a DSPy module execution.

        Args:
            call_id: Unique identifier for this call
            outputs: Output from the module, or None if there was an exception
            exception: Exception raised during execution, if any
        """
        span = self._spans.pop(call_id, None)
        if not span:
            return

        try:
            log_data = {}
            if exception:
                log_data["error"] = exception
            if outputs is not None:
                # Convert DSPy Prediction objects to dict for logging
                if hasattr(outputs, "toDict"):
                    output_dict = outputs.toDict()
                elif hasattr(outputs, "__dict__"):
                    output_dict = outputs.__dict__
                else:
                    output_dict = outputs
                log_data["output"] = output_dict

            if log_data:
                span.log(**log_data)
        finally:
            span.unset_current()
            span.end()

    def on_tool_start(
        self,
        call_id: str,
        instance: Any,
        inputs: dict[str, Any],
    ):
        """Log the start of a tool invocation.

        Args:
            call_id: Unique identifier for this call
            instance: The Tool instance being called
            inputs: Input parameters to the tool
        """
        # Get tool name
        tool_name = "unknown"
        if hasattr(instance, "name"):
            tool_name = instance.name
        elif hasattr(instance, "__name__"):
            tool_name = instance.__name__
        elif hasattr(instance, "func") and hasattr(instance.func, "__name__"):
            tool_name = instance.func.__name__

        # Get the current active span to establish parent-child relationship
        parent = current_span()
        parent_export = parent.export() if parent else None

        span = start_span(
            name=tool_name,
            span_attributes={"type": SpanTypeAttribute.TOOL},
            input=inputs,
            parent=parent_export,
        )
        # Manually set as current span so children can find it
        span.set_current()
        self._spans[call_id] = span

    def on_tool_end(
        self,
        call_id: str,
        outputs: dict[str, Any] | None,
        exception: Exception | None = None,
    ):
        """Log the end of a tool invocation.

        Args:
            call_id: Unique identifier for this call
            outputs: Output from the tool, or None if there was an exception
            exception: Exception raised during execution, if any
        """
        span = self._spans.pop(call_id, None)
        if not span:
            return

        try:
            log_data = {}
            if exception:
                log_data["error"] = exception
            if outputs is not None:
                log_data["output"] = outputs

            if log_data:
                span.log(**log_data)
        finally:
            span.unset_current()
            span.end()

    def on_evaluate_start(
        self,
        call_id: str,
        instance: Any,
        inputs: dict[str, Any],
    ):
        """Log the start of an evaluation run.

        Args:
            call_id: Unique identifier for this call
            instance: The Evaluate instance
            inputs: Input parameters to the evaluation
        """
        metadata = {}
        # Extract evaluation metadata
        if hasattr(instance, "metric") and instance.metric:
            if hasattr(instance.metric, "__name__"):
                metadata["metric"] = instance.metric.__name__
        if hasattr(instance, "num_threads"):
            metadata["num_threads"] = instance.num_threads

        # Get the current active span to establish parent-child relationship
        parent = current_span()
        parent_export = parent.export() if parent else None

        span = start_span(
            name="dspy.evaluate",
            input=inputs,
            metadata=metadata,
            parent=parent_export,
        )
        # Manually set as current span so children can find it
        span.set_current()
        self._spans[call_id] = span

    def on_evaluate_end(
        self,
        call_id: str,
        outputs: Any | None,
        exception: Exception | None = None,
    ):
        """Log the end of an evaluation run.

        Args:
            call_id: Unique identifier for this call
            outputs: Output from the evaluation, or None if there was an exception
            exception: Exception raised during execution, if any
        """
        span = self._spans.pop(call_id, None)
        if not span:
            return

        try:
            log_data = {}
            if exception:
                log_data["error"] = exception
            if outputs is not None:
                log_data["output"] = outputs
                # Extract metrics from evaluation results
                if isinstance(outputs, dict):
                    metrics = {}
                    # Common evaluation metrics
                    for key in ["accuracy", "score", "total", "correct"]:
                        if key in outputs:
                            try:
                                metrics[key] = float(outputs[key])
                            except (ValueError, TypeError):
                                pass
                    if metrics:
                        log_data["metrics"] = metrics

            if log_data:
                span.log(**log_data)
        finally:
            span.unset_current()
            span.end()


def _configure_wrapper(wrapped, instance, args, kwargs):
    """Wrapper for dspy.configure that auto-adds BraintrustDSpyCallback."""
    callbacks = kwargs.get("callbacks")
    if callbacks is None:
        callbacks = []
    else:
        callbacks = list(callbacks)

    # Check if already has Braintrust callback
    has_bt_callback = any(isinstance(cb, BraintrustDSpyCallback) for cb in callbacks)
    if not has_bt_callback:
        callbacks.append(BraintrustDSpyCallback())

    kwargs["callbacks"] = callbacks
    return wrapped(*args, **kwargs)


def patch_dspy() -> bool:
    """
    Patch DSPy to automatically add Braintrust tracing callback.

    After calling this, all calls to dspy.configure() will automatically
    include the BraintrustDSpyCallback.

    Returns:
        True if DSPy was patched (or already patched), False if DSPy is not installed.

    Example:
        ```python
        import braintrust
        braintrust.patch_dspy()

        import dspy
        lm = dspy.LM("openai/gpt-4o-mini")
        dspy.configure(lm=lm)  # BraintrustDSpyCallback auto-added!
        ```
    """
    try:
        import dspy

        if getattr(dspy, "__braintrust_wrapped__", False):
            return True  # Already patched

        wrap_function_wrapper("dspy", "configure", _configure_wrapper)
        dspy.__braintrust_wrapped__ = True
        return True

    except ImportError:
        return False
