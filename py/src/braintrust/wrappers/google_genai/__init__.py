import logging
import time
from collections.abc import Iterable
from typing import Any

from braintrust.bt_json import bt_safe_deep_copy
from braintrust.logger import NOOP_SPAN, Attachment, current_span, init_logger, start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

logger = logging.getLogger(__name__)


def setup_genai(
    api_key: str | None = None,
    project_id: str | None = None,
    project_name: str | None = None,
) -> bool:
    """
    Setup Braintrust integration with Google GenAI.

    Returns:
        True if setup was successful, False if google-genai is not installed.
    """
    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project_name, api_key=api_key, project_id=project_id)

    try:
        import google.genai as genai  # pyright: ignore
        from google.genai import models

        genai.Client = wrap_client(genai.Client)
        models.Models = wrap_models(models.Models)
        models.AsyncModels = wrap_async_models(models.AsyncModels)
        return True
    except ImportError:
        return False


def wrap_client(Client: Any):
    if is_patched(Client):
        return Client

    # noop for now, but may be useful in the future

    mark_patched(Client)
    return Client


def wrap_models(Models: Any):
    if is_patched(Models):
        return Models

    def wrap_generate_content(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input, clean_kwargs = get_args_kwargs(args, kwargs, ["model", "contents", "config"])

        input = _serialize_input(instance._api_client, input)

        clean_kwargs["model"] = input["model"]

        start = time.time()
        with start_span(
            name="generate_content", type=SpanTypeAttribute.LLM, input=input, metadata=clean_kwargs
        ) as span:
            result = wrapped(*args, **kwargs)
            metrics = _extract_generate_content_metrics(result, start)
            span.log(output=result, metrics=metrics)
            return result

    wrap_function_wrapper(Models, "_generate_content", wrap_generate_content)

    def wrap_generate_content_stream(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input, clean_kwargs = get_args_kwargs(args, kwargs, ["model", "contents", "config"])

        input = _serialize_input(instance._api_client, input)

        clean_kwargs["model"] = input["model"]

        start = time.time()
        first_token_time = None
        with start_span(
            name="generate_content_stream", type=SpanTypeAttribute.LLM, input=input, metadata=clean_kwargs
        ) as span:
            chunks = []
            for chunk in wrapped(*args, **kwargs):
                if first_token_time is None:
                    first_token_time = time.time()
                chunks.append(chunk)
                yield chunk

            aggregated, metrics = _aggregate_generate_content_chunks(chunks, start, first_token_time)
            span.log(output=aggregated, metrics=metrics)
            return aggregated

    wrap_function_wrapper(Models, "generate_content_stream", wrap_generate_content_stream)

    mark_patched(Models)
    return Models


def wrap_async_models(AsyncModels: Any):
    if is_patched(AsyncModels):
        return AsyncModels

    async def wrap_generate_content(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input, clean_kwargs = get_args_kwargs(args, kwargs, ["model", "contents", "config"])

        input = _serialize_input(instance._api_client, input)

        clean_kwargs["model"] = input["model"]

        start = time.time()
        with start_span(
            name="generate_content", type=SpanTypeAttribute.LLM, input=input, metadata=clean_kwargs
        ) as span:
            result = await wrapped(*args, **kwargs)
            metrics = _extract_generate_content_metrics(result, start)
            span.log(output=result, metrics=metrics)
            return result

    wrap_function_wrapper(AsyncModels, "generate_content", wrap_generate_content)

    async def wrap_generate_content_stream(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input, clean_kwargs = get_args_kwargs(args, kwargs, ["model", "contents", "config"])

        input = _serialize_input(instance._api_client, input)

        clean_kwargs["model"] = input["model"]

        async def stream_generator():
            start = time.time()
            first_token_time = None
            with start_span(
                name="generate_content_stream", type=SpanTypeAttribute.LLM, input=input, metadata=clean_kwargs
            ) as span:
                chunks = []
                async for chunk in await wrapped(*args, **kwargs):
                    if first_token_time is None:
                        first_token_time = time.time()
                    chunks.append(chunk)
                    yield chunk

                aggregated, metrics = _aggregate_generate_content_chunks(chunks, start, first_token_time)
                span.log(output=aggregated, metrics=metrics)

        return stream_generator()

    wrap_function_wrapper(AsyncModels, "generate_content_stream", wrap_generate_content_stream)

    mark_patched(AsyncModels)
    return AsyncModels


def _serialize_input(api_client: Any, input: dict[str, Any]):
    config = bt_safe_deep_copy(input.get("config"))

    if config is not None:
        tools = _serialize_tools(api_client, input)

        if tools is not None:
            config["tools"] = tools

        input["config"] = config

    # Serialize contents to handle binary data (e.g., images)
    if "contents" in input:
        input["contents"] = _serialize_contents(input["contents"])

    return input


def _serialize_contents(contents: Any) -> Any:
    """Serialize contents, converting binary data to base64-encoded data URLs."""
    if contents is None:
        return None

    # Handle list of contents
    if isinstance(contents, list):
        return [_serialize_content_item(item) for item in contents]

    # Handle single content item
    return _serialize_content_item(contents)


def _serialize_content_item(item: Any) -> Any:
    """Serialize a single content item, handling binary data."""
    # If it's already a dict, return as-is
    if isinstance(item, dict):
        return item

    # Handle Part objects from google.genai
    if hasattr(item, "__class__") and item.__class__.__name__ == "Part":
        # Try to extract the data from the Part
        if hasattr(item, "text") and item.text is not None:
            return {"text": item.text}
        elif hasattr(item, "inline_data"):
            # Handle binary data (e.g., images)
            inline_data = item.inline_data
            if hasattr(inline_data, "data") and hasattr(inline_data, "mime_type"):
                # Convert bytes to Attachment
                data = inline_data.data
                mime_type = inline_data.mime_type

                # Ensure data is bytes
                if isinstance(data, bytes):
                    # Determine file extension from mime type
                    extension = mime_type.split("/")[1] if "/" in mime_type else "bin"
                    filename = f"file.{extension}"

                    # Create an Attachment object
                    attachment = Attachment(data=data, filename=filename, content_type=mime_type)

                    # Return the attachment object in image_url format
                    # The SDK's _extract_attachments will replace it with its reference when logging
                    return {"image_url": {"url": attachment}}

        # Try to use built-in serialization if available
        if hasattr(item, "model_dump"):
            return item.model_dump()
        elif hasattr(item, "dump"):
            return item.dump()
        elif hasattr(item, "to_dict"):
            return item.to_dict()

    # Return the item as-is if we can't serialize it
    return item


def _serialize_tools(api_client: Any, input: Any | None):
    try:
        from google.genai.models import (
            _GenerateContentParameters_to_mldev,  # pyright: ignore [reportPrivateUsage]
            _GenerateContentParameters_to_vertex,  # pyright: ignore [reportPrivateUsage]
        )

        # cheat by reusing genai library's serializers (they deal with interpreting a function signature etc.)
        if api_client.vertexai:
            serialized = _GenerateContentParameters_to_vertex(api_client, input)
        else:
            serialized = _GenerateContentParameters_to_mldev(api_client, input)

        tools = serialized.get("tools")
        return tools
    except Exception:
        return None


def omit(obj: dict[str, Any], keys: Iterable[str]):
    return {k: v for k, v in obj.items() if k not in keys}


def is_patched(obj: Any):
    return getattr(obj, "_braintrust_patched", False)


def mark_patched(obj: Any):
    return setattr(obj, "_braintrust_patched", True)


def get_args_kwargs(args: list[str], kwargs: dict[str, Any], keys: Iterable[str]):
    return {k: args[i] if args else kwargs.get(k) for i, k in enumerate(keys)}, omit(kwargs, keys)


def _extract_generate_content_metrics(response: Any, start: float) -> dict[str, Any]:
    """Extract metrics from a non-streaming generate_content response."""
    end_time = time.time()
    metrics = dict(
        start=start,
        end=end_time,
        duration=end_time - start,
    )

    # Extract usage metadata if available
    if hasattr(response, "usage_metadata") and response.usage_metadata:
        usage_metadata = response.usage_metadata

        # Extract token metrics
        if hasattr(usage_metadata, "prompt_token_count"):
            metrics["prompt_tokens"] = usage_metadata.prompt_token_count
        if hasattr(usage_metadata, "candidates_token_count"):
            metrics["completion_tokens"] = usage_metadata.candidates_token_count
        if hasattr(usage_metadata, "total_token_count"):
            metrics["tokens"] = usage_metadata.total_token_count
        if hasattr(usage_metadata, "cached_content_token_count"):
            metrics["prompt_cached_tokens"] = usage_metadata.cached_content_token_count

        # Extract additional metrics for thinking/reasoning tokens
        if hasattr(usage_metadata, "thoughts_token_count"):
            metrics["completion_reasoning_tokens"] = usage_metadata.thoughts_token_count

        # Extract tool use prompt tokens if available
        if hasattr(usage_metadata, "tool_use_prompt_token_count"):
            # Add to prompt_tokens if not already counted
            tool_tokens = usage_metadata.tool_use_prompt_token_count
            if tool_tokens and "prompt_tokens" in metrics:
                # Tool tokens are typically part of prompt tokens, but track separately if needed
                pass

    return clean(dict(metrics))


def _aggregate_generate_content_chunks(
    chunks: list[Any], start: float, first_token_time: float | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Aggregate streaming chunks into a single response with metrics."""
    end_time = time.time()
    metrics = dict(
        start=start,
        end=end_time,
        duration=end_time - start,
    )

    # Add time_to_first_token if available
    if first_token_time is not None:
        metrics["time_to_first_token"] = first_token_time - start

    if not chunks:
        return {}, metrics

    # Accumulate text and metadata
    text = ""
    thought_text = ""
    other_parts = []
    usage_metadata = None
    last_response = None

    for chunk in chunks:
        last_response = chunk

        # Accumulate usage metadata
        if hasattr(chunk, "usage_metadata") and chunk.usage_metadata:
            usage_metadata = chunk.usage_metadata

        # Process candidates and their parts
        if hasattr(chunk, "candidates") and chunk.candidates:
            for candidate in chunk.candidates:
                if hasattr(candidate, "content") and candidate.content:
                    if hasattr(candidate.content, "parts") and candidate.content.parts:
                        for part in candidate.content.parts:
                            # Handle text parts
                            if hasattr(part, "text") and part.text:
                                if hasattr(part, "thought") and part.thought:
                                    thought_text += part.text
                                else:
                                    text += part.text
                            # Collect non-text parts
                            elif hasattr(part, "function_call"):
                                other_parts.append({"function_call": part.function_call})
                            elif hasattr(part, "code_execution_result"):
                                other_parts.append({"code_execution_result": part.code_execution_result})
                            elif hasattr(part, "executable_code"):
                                other_parts.append({"executable_code": part.executable_code})

    # Build aggregated response
    aggregated = {}

    # Build parts list
    parts = []
    if thought_text:
        parts.append({"text": thought_text, "thought": True})
    if text:
        parts.append({"text": text})
    parts.extend(other_parts)

    # Build candidates
    if parts and last_response and hasattr(last_response, "candidates"):
        candidates = []
        for candidate in last_response.candidates:
            candidate_dict = {"content": {"parts": parts, "role": "model"}}

            # Add metadata from last candidate
            if hasattr(candidate, "finish_reason"):
                candidate_dict["finish_reason"] = candidate.finish_reason
            if hasattr(candidate, "safety_ratings"):
                candidate_dict["safety_ratings"] = candidate.safety_ratings

            candidates.append(candidate_dict)

        aggregated["candidates"] = candidates

    # Add usage metadata
    if usage_metadata:
        aggregated["usage_metadata"] = usage_metadata

        # Extract token metrics
        if hasattr(usage_metadata, "prompt_token_count"):
            metrics["prompt_tokens"] = usage_metadata.prompt_token_count
        if hasattr(usage_metadata, "candidates_token_count"):
            metrics["completion_tokens"] = usage_metadata.candidates_token_count
        if hasattr(usage_metadata, "total_token_count"):
            metrics["tokens"] = usage_metadata.total_token_count
        if hasattr(usage_metadata, "cached_content_token_count"):
            metrics["prompt_cached_tokens"] = usage_metadata.cached_content_token_count

        # Extract additional metrics for thinking/reasoning tokens
        if hasattr(usage_metadata, "thoughts_token_count"):
            metrics["completion_reasoning_tokens"] = usage_metadata.thoughts_token_count

        # Extract tool use prompt tokens if available
        if hasattr(usage_metadata, "tool_use_prompt_token_count"):
            # Add to prompt_tokens if not already counted
            tool_tokens = usage_metadata.tool_use_prompt_token_count
            if tool_tokens and "prompt_tokens" in metrics:
                # Tool tokens are typically part of prompt tokens, but track separately if needed
                pass

    # Add convenience text property
    if text:
        aggregated["text"] = text

    clean_metrics = clean(dict(metrics))

    return aggregated, clean_metrics


def clean(obj: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in obj.items() if v is not None}


def get_path(obj: dict[str, Any], path: str, default: Any = None) -> Any | None:
    keys = path.split(".")
    current = obj

    for key in keys:
        if not (isinstance(current, dict) and key in current):
            return default
        current = current[key]

    return current
