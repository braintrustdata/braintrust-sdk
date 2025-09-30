import logging
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from wrapt import wrap_function_wrapper

from braintrust.logger import NOOP_SPAN, current_span, init_logger, start_span
from braintrust.metrics import StandardMetrics
from braintrust.span_types import SpanTypeAttribute

logger = logging.getLogger(__name__)


def setup_genai(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
):
    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project_name, api_key=api_key, project_id=project_id)

    try:
        import google.genai as genai  # pyright: ignore
        from google.genai import models

        genai.Client = wrap_client(genai.Client)
        models.Models = wrap_models(models.Models)
        models.AsyncModels = wrap_async_models(models.AsyncModels)
        pass
    except ImportError as e:
        logger.error(f"Failed to import Google ADK agents: {e}")
        logger.error("Google ADK is not installed. Please install it with: pip install google-adk")
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

        with start_span(
            name="generate_content", type=SpanTypeAttribute.LLM, input=input, metadata=clean_kwargs
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(output=result)
            return result

    wrap_function_wrapper(Models, "generate_content", wrap_generate_content)

    def wrap_generate_content_stream(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input, clean_kwargs = get_args_kwargs(args, kwargs, ["model", "contents", "config"])

        start = time.time()
        with start_span(
            name="generate_content_stream", type=SpanTypeAttribute.LLM, input=input, metadata=clean_kwargs
        ) as span:
            chunks = []
            for chunk in wrapped(*args, **kwargs):
                chunks.append(chunk)
                yield chunk

            aggregated, metrics = _aggregate_generate_content_chunks(chunks, start)
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

        with start_span(
            name="generate_content", type=SpanTypeAttribute.LLM, input=input, metadata=clean_kwargs
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(output=result)
            return result

    wrap_function_wrapper(AsyncModels, "generate_content", wrap_generate_content)

    async def wrap_generate_content_stream(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input, clean_kwargs = get_args_kwargs(args, kwargs, ["model", "contents", "config"])

        async def stream_generator():
            start = time.time()
            with start_span(
                name="generate_content_stream", type=SpanTypeAttribute.LLM, input=input, metadata=clean_kwargs
            ) as span:
                chunks = []
                async for chunk in await wrapped(*args, **kwargs):
                    chunks.append(chunk)
                    yield chunk

                aggregated, metrics = _aggregate_generate_content_chunks(chunks, start)
                span.log(output=aggregated, metrics=metrics)

        return stream_generator()

    wrap_function_wrapper(AsyncModels, "generate_content_stream", wrap_generate_content_stream)

    mark_patched(AsyncModels)
    return AsyncModels


def omit(obj: Dict[str, Any], keys: Iterable[str]):
    return {k: v for k, v in obj.items() if k not in keys}


def is_patched(obj: Any):
    return getattr(obj, "_braintrust_patched", False)


def mark_patched(obj: Any):
    return setattr(obj, "_braintrust_patched", True)


def get_args_kwargs(args: List[str], kwargs: Dict[str, Any], keys: Iterable[str]):
    return {k: args[i] if args else kwargs.get(k) for i, k in enumerate(keys)}, omit(kwargs, keys)


def _aggregate_generate_content_chunks(chunks: List[Any], start: float) -> Tuple[Dict[str, Any], StandardMetrics]:
    """Aggregate streaming chunks into a single response with metrics."""
    end_time = time.time()
    metrics = StandardMetrics(
        start=start,
        end=end_time,
        duration=end_time - start,
    )

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

    # Add convenience text property
    if text:
        aggregated["text"] = text

    return aggregated, clean(metrics)


def clean(obj: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in obj.items() if v is not None}
