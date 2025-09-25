"""
ModelWrapper class for Braintrust-Agno model observability.
"""

from typing import Any, Dict, Optional

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

from braintrust_agno.utils import is_patched, mark_patched


def wrap_model(Model: Any) -> Any:
    if is_patched(Model):
        return Model

    def invoke_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.invoke"

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.LLM,
            input=_extract_input_messages(*args, **kwargs),
            metadata={**_extract_model_metadata(instance), **_extract_input_metadata(*args, **kwargs)},
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(
                output=_extract_output_data(result),
                metrics=_extract_model_metrics(result, kwargs.get("messages", [])),
            )
            return result

    if hasattr(Model, "invoke"):
        wrap_function_wrapper(Model, "invoke", invoke_wrapper)

    async def ainvoke_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.ainvoke"

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.LLM,
            input=_extract_input_messages(*args, **kwargs),
            metadata={**_extract_model_metadata(instance), **_extract_input_metadata(*args, **kwargs)},
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(
                output=_extract_output_data(result),
                metrics=_extract_model_metrics(result, kwargs.get("messages", [])),
            )
            return result

    if hasattr(Model, "ainvoke"):
        wrap_function_wrapper(Model, "ainvoke", ainvoke_wrapper)

    def invoke_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.invoke_stream"

        def _trace_stream():
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.LLM,
                input=_extract_input_messages(*args, **kwargs),
                metadata={**_extract_model_metadata(instance), **_extract_input_metadata(*args, **kwargs)},
            ) as span:
                collected_chunks = []
                aggregated_metrics = {}
                for chunk in wrapped(*args, **kwargs):
                    collected_chunks.append(chunk)
                    # # Aggregate metrics from chunks if available
                    # if hasattr(chunk, "metrics"):
                    #     _aggregate_metrics(aggregated_metrics, _extract_metrics(chunk))
                    yield chunk

                span.log(
                    output=collected_chunks if collected_chunks else None,
                    # output=_combine_chunks(collected_chunks),
                    metrics=aggregated_metrics if aggregated_metrics else None,
                )

        return _trace_stream()

    if hasattr(Model, "invoke_stream"):
        wrap_function_wrapper(Model, "invoke_stream", invoke_stream_wrapper)

    async def ainvoke_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.ainvoke_stream"

        async def _trace_astream():
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.LLM,
                input=_extract_input_messages(*args, **kwargs),
                metadata={**_extract_model_metadata(instance), **_extract_input_metadata(*args, **kwargs)},
            ) as span:
                collected_chunks = []
                aggregated_metrics = {}
                async for chunk in wrapped(*args, **kwargs):
                    collected_chunks.append(chunk)
                    # # Aggregate metrics from chunks if available
                    # if hasattr(chunk, "metrics"):
                    #     _aggregate_metrics(aggregated_metrics, _extract_metrics(chunk))
                    yield chunk

                span.log(
                    output=collected_chunks if collected_chunks else None,
                    # output=_combine_chunks(collected_chunks),
                    metrics=aggregated_metrics if aggregated_metrics else None,
                )

        return _trace_astream()

    if hasattr(Model, "ainvoke_stream"):
        wrap_function_wrapper(Model, "ainvoke_stream", ainvoke_stream_wrapper)

    def response_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.response"

        with start_span(
            name=span_name,
            # TODO: should be LLM?
            type=SpanTypeAttribute.LLM,
            input=_extract_input_messages(*args, **kwargs),
            metadata={**_extract_model_metadata(instance), **_extract_input_metadata(*args, **kwargs)},
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=_extract_model_metrics(result, kwargs.get("messages", [])),
            )
            return result

    if hasattr(Model, "response"):
        wrap_function_wrapper(Model, "response", response_wrapper)

    async def aresponse_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.aresponse"

        with start_span(
            name=span_name,
            # TODO: should be LLM?
            type=SpanTypeAttribute.LLM,
            input=_extract_input_messages(*args, **kwargs),
            metadata={**_extract_model_metadata(instance), **_extract_input_metadata(*args, **kwargs)},
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=_extract_model_metrics(result, kwargs.get("messages", [])),
            )
            return result

    if hasattr(Model, "aresponse"):
        wrap_function_wrapper(Model, "aresponse", aresponse_wrapper)

    def response_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.response_stream"

        def _trace_stream():
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.LLM,
                input=_extract_input_messages(*args, **kwargs),
                metadata={**_extract_model_metadata(instance), **_extract_input_metadata(*args, **kwargs)},
            ) as span:
                collected_chunks = []
                aggregated_metrics = {}
                for chunk in wrapped(*args, **kwargs):
                    collected_chunks.append(chunk)
                    # # Aggregate metrics from chunks if available
                    # if hasattr(chunk, "metrics"):
                    #     _aggregate_metrics(aggregated_metrics, _extract_metrics(chunk))
                    yield chunk

                span.log(
                    output=collected_chunks if collected_chunks else None,
                    # output=_combine_chunks(collected_chunks),
                    metrics=aggregated_metrics if aggregated_metrics else None,
                )

        return _trace_stream()

    if hasattr(Model, "response_stream"):
        wrap_function_wrapper(Model, "response_stream", response_stream_wrapper)

    async def aresponse_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.aresponse_stream"

        async def _trace_astream():
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.LLM,
                input=_extract_input_messages(*args, **kwargs),
                metadata={**_extract_model_metadata(instance), **_extract_input_metadata(*args, **kwargs)},
            ) as span:
                collected_chunks = []
                aggregated_metrics = {}
                async for chunk in wrapped(*args, **kwargs):
                    collected_chunks.append(chunk)
                    # # Aggregate metrics from chunks if available
                    # if hasattr(chunk, "metrics"):
                    #     _aggregate_metrics(aggregated_metrics, _extract_metrics(chunk))
                    yield chunk

                span.log(
                    output=collected_chunks if collected_chunks else None,
                    # output=_combine_chunks(collected_chunks),
                    metrics=aggregated_metrics if aggregated_metrics else None,
                )

        return _trace_astream()

    if hasattr(Model, "aresponse_stream"):
        wrap_function_wrapper(Model, "aresponse_stream", aresponse_stream_wrapper)

    mark_patched(Model)
    return Model


def _try_to_dict(obj: Any) -> Any:
    """Convert object to dict, handling different object types like OpenAI wrapper."""
    if isinstance(obj, dict):
        return obj
    # convert a pydantic object to a dict
    if hasattr(obj, "model_dump") and callable(obj.model_dump):
        try:
            return obj.model_dump()
        except Exception:
            pass
    # deprecated pydantic method, try model_dump first.
    if hasattr(obj, "dict") and callable(obj.dict):
        try:
            return obj.dict()
        except Exception:
            pass
    # handle objects with __dict__ (like Agno Metrics objects)
    if hasattr(obj, "__dict__"):
        try:
            return obj.__dict__.copy()
        except Exception:
            pass
    return obj


def _is_numeric(v):
    """Check if value is numeric like OpenAI wrapper."""
    return isinstance(v, (int, float, complex))


# Agno field names to canonical Braintrust field names (following OpenAI wrapper pattern)
AGNO_METRICS_MAP = {
    # Core token metrics - using OpenAI wrapper naming
    "input_tokens": "prompt_tokens",
    "output_tokens": "completion_tokens",
    "total_tokens": "tokens",
    # Reasoning and audio tokens
    "reasoning_tokens": "completion_reasoning_tokens",
    "audio_input_tokens": "prompt_audio_tokens",
    "audio_output_tokens": "completion_audio_tokens",
    # Cache tokens
    "cache_read_tokens": "prompt_cached_tokens",
    "cache_write_tokens": "prompt_cache_creation_tokens",
    # Timing metrics
    "duration": "duration",
    "time_to_first_token": "time_to_first_token",
}


def _parse_metrics_from_agno(usage: Any) -> Dict[str, Any]:
    """Parse metrics from Agno usage object, following OpenAI wrapper pattern."""
    metrics = {}

    if not usage:
        return metrics

    # Convert to dict like OpenAI wrapper
    usage_dict = _try_to_dict(usage)
    if not isinstance(usage_dict, dict):
        return metrics

    # Simple loop through Agno fields and map to Braintrust names
    for agno_name, value in usage_dict.items():
        if agno_name in AGNO_METRICS_MAP and _is_numeric(value) and value != 0:
            braintrust_name = AGNO_METRICS_MAP[agno_name]
            metrics[braintrust_name] = value

    return metrics


def _get_model_name(instance: Any) -> str:
    if hasattr(instance, "get_provider") and callable(instance.get_provider):
        return str(instance.get_provider())
    return getattr(instance.__class__, "__name__", "Model")


def _extract_input_messages(*args, **kwargs) -> Any:
    """Extract messages with minimal fixes for Braintrust compatibility."""
    messages = kwargs.get("messages", [])
    if not isinstance(messages, list):
        return messages

    # Convert Agno message objects to dicts and fix content field
    fixed_messages = []
    for msg in messages:
        # Convert Pydantic model to dict
        if hasattr(msg, "model_dump"):
            msg_dict = msg.model_dump()  # Pydantic v2
        elif hasattr(msg, "dict"):
            msg_dict = msg.dict()  # Pydantic v1
        else:
            msg_dict = msg  # Already a dict

        # Fix content field if None (required for OpenAI compatibility)
        if msg_dict.get("content") is None:
            msg_dict["content"] = ""

        # Remove tool_calls if null/empty (Zod parser expects omission, not null)
        if msg_dict.get("tool_calls") in [None, [], ""]:
            msg_dict.pop("tool_calls", None)

        # Remove name if null (Zod parser expects omission, not null)
        if msg_dict.get("name") is None:
            msg_dict.pop("name", None)

        # Remove tool_call_id if null (should only be present on tool messages)
        if msg_dict.get("tool_call_id") is None:
            msg_dict.pop("tool_call_id", None)

        # Remove ALL null fields - Zod parser expects missing fields, not null
        keys_to_remove = [key for key, value in msg_dict.items() if value is None]
        for key in keys_to_remove:
            msg_dict.pop(key, None)

        fixed_messages.append(msg_dict)

    return fixed_messages


def _extract_input_metadata(*args, **kwargs) -> dict:
    """Extract non-message fields for Braintrust metadata."""
    # Only include essential fields, excluding Agno-specific data that confuses Try Prompt
    allowed_fields = [
        "model",
        "temperature",
        "max_tokens",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "stop",
    ]
    metadata = {k: v for k, v in kwargs.items() if k in allowed_fields}

    # Don't add args or other Agno-specific data that causes Try Prompt conflicts
    return metadata


def _extract_model_metadata(instance: Any) -> Dict[str, Any]:
    """Extract metadata about the model."""
    metadata = {"component": "model"}

    if hasattr(instance, "id") and instance.id:
        metadata["model"] = instance.id
        metadata["model_id"] = instance.id
    if hasattr(instance, "provider") and instance.provider:
        metadata["provider"] = instance.provider
    if hasattr(instance, "name") and instance.name:
        metadata["model_name"] = instance.name
    if hasattr(instance, "__class__"):
        metadata["model_class"] = instance.__class__.__name__

    return metadata


def _extract_output_data(result) -> Any:
    """Extract output data with minimal fixes for Braintrust compatibility."""
    # Simplified output - just extract content and return minimal structure
    content = ""

    # Try to get content from various formats
    if hasattr(result, "content"):
        content = result.content or ""
    elif isinstance(result, dict):
        content = result.get("content", "")
    elif hasattr(result, "model_dump"):
        result_dict = result.model_dump()
        content = result_dict.get("content", "")
    elif hasattr(result, "__dict__"):
        content = getattr(result, "content", "") or result.__dict__.get("content", "")

    # Return minimal OpenAI-compatible output
    return [{"role": "assistant", "content": content}]


def _extract_model_metrics(result: Any, messages: Optional[list] = None) -> Dict[str, Any]:
    """Extract metrics from model response using standard Braintrust names."""
    # Try the original approach first (for backwards compatibility)
    if hasattr(result, "response_usage") and result.response_usage:
        return _parse_metrics_from_agno(result.response_usage)

    # If no metrics found and we have messages, look for metrics in assistant messages
    if messages:
        for msg in messages:
            # Look for assistant messages with metrics
            if hasattr(msg, "role") and msg.role == "assistant" and hasattr(msg, "metrics") and msg.metrics:
                return _parse_metrics_from_agno(msg.metrics)

    return {}


def _combine_chunks(chunks: list) -> Any:
    """Combine streaming chunks into a single output."""
    if not chunks:
        return None

    # If chunks have content attribute, combine them
    if all(hasattr(chunk, "content") for chunk in chunks):
        combined_content = "".join(str(chunk.content) for chunk in chunks if chunk.content)
        return {"content": combined_content}

    # If chunks have text attribute, combine them
    if all(hasattr(chunk, "text") for chunk in chunks):
        combined_text = "".join(str(chunk.text) for chunk in chunks if chunk.text)
        return {"text": combined_text}

    # Return last chunk as representative output
    return _try_to_dict(chunks[-1]) if chunks else None
