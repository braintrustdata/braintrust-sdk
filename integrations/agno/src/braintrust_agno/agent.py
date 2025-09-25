from typing import Any, Dict, Optional

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

from .utils import is_patched, mark_patched, omit


def wrap_agent(Agent: Any) -> Any:
    if is_patched(Agent):
        return Agent

    def run_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Agent"
        span_name = f"{agent_name}.run"

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input=args,
            metadata=omit(kwargs, ["audio", "images", "videos"]),
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(
                output=result, metrics=_extract_run_metrics(result), metadata=_extract_agent_metadata(instance, result)
            )
            return result

    wrap_function_wrapper(Agent, "run", run_wrapper)

    async def arun_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Agent"
        span_name = f"{agent_name}.arun"

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input=args,
            metadata=omit(kwargs, ["audio", "images", "videos"]),
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(
                output=result, metrics=_extract_run_metrics(result), metadata=_extract_agent_metadata(instance, result)
            )
            return result

    if hasattr(Agent, "_arun"):
        wrap_function_wrapper(Agent, "_arun", arun_wrapper)

    def run_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Agent"
        span_name = f"{agent_name}.run_stream"

        def _trace_stream():
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input=args if args else None,
                metadata=_extract_metadata(instance, kwargs),
            ) as span:
                collected_output = []
                for chunk in wrapped(*args, **kwargs):
                    collected_output.append(chunk)
                    yield chunk

                result = getattr(instance, "run_response", None) or collected_output
                span.log(output=result)

        return _trace_stream()

    if hasattr(Agent, "_run_stream"):
        wrap_function_wrapper(Agent, "_run_stream", run_stream_wrapper)

    async def arun_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Agent"
        span_name = f"{agent_name}.arun_stream"

        async def _trace_stream():
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input=args if args else None,
                metadata=_extract_metadata(instance, kwargs),
            ) as span:
                collected_output = []
                async for chunk in wrapped(*args, **kwargs):
                    collected_output.append(chunk)
                    yield chunk

                result = getattr(instance, "run_response", None) or collected_output
                span.log(output=result)

        return _trace_stream()

    if hasattr(Agent, "_arun_stream"):
        wrap_function_wrapper(Agent, "_arun_stream", arun_stream_wrapper)

    mark_patched(Agent)
    return Agent


def _extract_metadata(instance: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """Extract metadata from an agent instance and kwargs."""
    metadata = {"component": "agent"}

    # Add agent metadata
    if hasattr(instance, "name") and instance.name:
        metadata["agent_name"] = instance.name

    if hasattr(instance, "model") and instance.model:
        # Extract model information
        if hasattr(instance.model, "id"):
            metadata["model"] = instance.model.id
        elif hasattr(instance.model, "name"):
            metadata["model"] = instance.model.name
        else:
            metadata["model"] = str(instance.model.__class__.__name__)

    if hasattr(instance, "instructions") and instance.instructions:
        metadata["instructions"] = instance.instructions[:200]  # Truncate long instructions

    if hasattr(instance, "tools") and instance.tools:
        # Extract tool names if available
        tool_names = []
        for tool in instance.tools:
            if hasattr(tool, "__name__"):
                tool_names.append(tool.__name__)
            elif hasattr(tool, "name"):
                tool_names.append(tool.name)
            else:
                tool_names.append(str(tool))
        metadata["tools"] = tool_names  # pyright: ignore

    # Add relevant kwargs, excluding sensitive data
    metadata.update(omit(kwargs, ["audio", "images", "videos", "api_key", "secret"]))

    return metadata


def _extract_agent_metadata(instance: Any, result: Any) -> Dict[str, Any]:
    """Extract metadata about the agent."""
    metadata = {"component": "agent"}

    if hasattr(instance, "name") and instance.name:
        metadata["agent_name"] = instance.name
    if hasattr(instance, "model") and instance.model:
        # Extract just the model ID instead of the full object
        if hasattr(instance.model, "id"):
            metadata["model"] = instance.model.id
        else:
            metadata["model"] = str(instance.model.__class__.__name__)

    return metadata


def _extract_run_metrics(result: Any) -> Optional[Dict[str, Any]]:
    metrics = {}

    if hasattr(result, "metrics"):
        agno_metrics = result.metrics

        if hasattr(agno_metrics, "input_tokens") and agno_metrics.input_tokens:
            metrics["prompt_tokens"] = agno_metrics.input_tokens
        if hasattr(agno_metrics, "output_tokens") and agno_metrics.output_tokens:
            metrics["completion_tokens"] = agno_metrics.output_tokens
        if hasattr(agno_metrics, "total_tokens") and agno_metrics.total_tokens:
            metrics["total_tokens"] = agno_metrics.total_tokens
        if hasattr(agno_metrics, "duration") and agno_metrics.duration:
            metrics["duration"] = agno_metrics.duration
        if hasattr(agno_metrics, "time_to_first_token") and agno_metrics.time_to_first_token:
            metrics["time_to_first_token"] = agno_metrics.time_to_first_token

    return metrics if metrics else None
