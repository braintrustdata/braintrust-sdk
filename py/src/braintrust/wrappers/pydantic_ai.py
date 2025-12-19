"""Braintrust integration for Pydantic AI.

This module provides automatic tracing for Pydantic AI agents and direct API calls.
"""
import logging
import time
from contextlib import AbstractAsyncContextManager
from typing import Any, AsyncGenerator, Dict, Iterable, Optional, TypeVar, Union

from braintrust.logger import NOOP_SPAN, Attachment, current_span, init_logger, start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

logger = logging.getLogger(__name__)

__all__ = ["setup_pydantic_ai", "wrap_pydantic_ai"]


def setup_pydantic_ai(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
) -> bool:
    """
    Setup Braintrust integration with Pydantic AI. Will automatically patch Pydantic AI Agents and direct API functions for automatic tracing.

    Args:
        api_key (Optional[str]): Braintrust API key.
        project_id (Optional[str]): Braintrust project ID.
        project_name (Optional[str]): Braintrust project name.

    Returns:
        bool: True if setup was successful, False otherwise.
    """
    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project_name, api_key=api_key, project_id=project_id)

    try:
        from pydantic_ai import Agent, direct

        Agent = wrap_agent(Agent)

        direct.model_request = wrap_model_request(direct.model_request)
        direct.model_request_sync = wrap_model_request_sync(direct.model_request_sync)
        direct.model_request_stream = wrap_model_request_stream(direct.model_request_stream)
        direct.model_request_stream_sync = wrap_model_request_stream_sync(direct.model_request_stream_sync)

        wrap_model_classes()

        return True
    except ImportError as e:
        logger.error(f"Failed to import Pydantic AI: {e}")
        logger.error("Pydantic AI is not installed. Please install it with: pip install pydantic-ai-slim")
        return False


wrap_pydantic_ai = setup_pydantic_ai


def wrap_agent(Agent: Any) -> Any:
    if _is_patched(Agent):
        return Agent

    async def agent_run_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)

        with start_span(
            name=f"agent_run [{instance.name}]" if hasattr(instance, "name") and instance.name else "agent_run",
            type=SpanTypeAttribute.LLM,
            input=input_data if input_data else None,
            metadata=_try_dict(metadata),
        ) as agent_span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)
            end_time = time.time()

            output = _serialize_result_output(result)
            metrics = _extract_usage_metrics(result, start_time, end_time)

            agent_span.log(output=output, metrics=metrics)
            return result

    wrap_function_wrapper(Agent, "run", agent_run_wrapper)


    def agent_run_sync_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)

        with start_span(
            name=f"agent_run_sync [{instance.name}]" if hasattr(instance, "name") and instance.name else "agent_run_sync",
            type=SpanTypeAttribute.LLM,
            input=input_data if input_data else None,
            metadata=_try_dict(metadata),
        ) as agent_span:
            start_time = time.time()
            result = wrapped(*args, **kwargs)
            end_time = time.time()

            output = _serialize_result_output(result)
            metrics = _extract_usage_metrics(result, start_time, end_time)

            agent_span.log(output=output, metrics=metrics)
            return result

    wrap_function_wrapper(Agent, "run_sync", agent_run_sync_wrapper)

    async def agent_run_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)
        agent_name = instance.name if hasattr(instance, "name") else None
        return _StreamedRunContextWrapper(
            wrapped(*args, **kwargs),
            input_data if input_data else None,
            metadata,
            agent_name
        )

    wrap_function_wrapper(Agent, "run_stream", agent_run_stream_wrapper)

    def agent_run_stream_sync_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)
        agent_name = instance.name if hasattr(instance, "name") else None
        return _StreamedRunContextWrapperSync(
            wrapped(*args, **kwargs),
            input_data if input_data else None,
            metadata,
            agent_name
        )

    wrap_function_wrapper(Agent, "run_stream_sync", agent_run_stream_sync_wrapper)


    async def agent_run_stream_events_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)

        agent_name = instance.name if hasattr(instance, "name") else None
        span_name = f"agent_run_stream_events [{agent_name}]" if agent_name else "agent_run_stream_events"

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.LLM,
            input=input_data if input_data else None,
            metadata=_try_dict(metadata),
        ) as agent_span:
            start_time = time.time()
            event_count = 0
            final_result = None

            async for event in wrapped(*args, **kwargs):
                event_count += 1
                if hasattr(event, "output"):
                    final_result = event
                yield event

            end_time = time.time()

            output = None
            metrics = {"start": start_time, "end": end_time, "duration": end_time - start_time, "event_count": event_count}

            if final_result:
                output = _serialize_result_output(final_result)
                usage_metrics = _extract_usage_metrics(final_result, start_time, end_time)
                metrics.update(usage_metrics)

            agent_span.log(output=output, metrics=metrics)

    wrap_function_wrapper(Agent, "run_stream_events", agent_run_stream_events_wrapper)

    Agent._braintrust_patched = True

    return Agent



def wrap_model_request(original_func: Any) -> Any:
    async def wrapper(*args, **kwargs):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)

        with start_span(
            name="model_request",
            type=SpanTypeAttribute.LLM,
            input=input_data,
            metadata=_try_dict(metadata),
        ) as span:
            start_time = time.time()
            result = await original_func(*args, **kwargs)
            end_time = time.time()

            output = _serialize_model_response(result)
            metrics = _extract_response_metrics(result, start_time, end_time)

            span.log(output=output, metrics=metrics)
            return result

    return wrapper


def wrap_model_request_sync(original_func: Any) -> Any:
    def wrapper(*args, **kwargs):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)

        with start_span(
            name="model_request_sync",
            type=SpanTypeAttribute.LLM,
            input=input_data,
            metadata=_try_dict(metadata),
        ) as span:
            start_time = time.time()
            result = original_func(*args, **kwargs)
            end_time = time.time()

            output = _serialize_model_response(result)
            metrics = _extract_response_metrics(result, start_time, end_time)

            span.log(output=output, metrics=metrics)
            return result

    return wrapper


def wrap_model_request_stream(original_func: Any) -> Any:
    def wrapper(*args, **kwargs):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)
        return _StreamContextWrapper(
            original_func(*args, **kwargs),
            input_data,
            metadata,
        )

    return wrapper


def wrap_model_request_stream_sync(original_func: Any) -> Any:
    def wrapper(*args, **kwargs):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)
        return _StreamContextWrapperSync(
            original_func(*args, **kwargs),
            input_data,
            metadata,
        )

    return wrapper


def wrap_model_classes():
    """Wrap Model classes to capture internal model requests made by agents."""
    try:
        from pydantic_ai.models import Model

        def wrap_all_subclasses(base_class):
            """Recursively wrap all subclasses of a base class."""
            for subclass in base_class.__subclasses__():
                if not getattr(subclass, "__abstractmethods__", None):
                    try:
                        _wrap_concrete_model_class(subclass)
                    except Exception as e:
                        logger.debug(f"Could not wrap {subclass.__name__}: {e}")

                wrap_all_subclasses(subclass)

        wrap_all_subclasses(Model)

    except Exception as e:
        logger.warning(f"Failed to wrap Model classes: {e}")


def _build_model_class_input_and_metadata(instance: Any, args: Any, kwargs: Any):
    """Build input data and metadata for model class request wrappers.

    Returns:
        Tuple of (model_name, display_name, input_data, metadata)
    """
    model_name, provider = _extract_model_info_from_model_instance(instance)
    display_name = model_name or str(instance)

    messages = args[0] if len(args) > 0 else kwargs.get("messages")
    model_settings = args[1] if len(args) > 1 else kwargs.get("model_settings")

    serialized_messages = _serialize_messages(messages)

    input_data = {"messages": serialized_messages}
    if model_settings is not None:
        input_data["model_settings"] = _try_dict(model_settings)

    metadata = _build_model_metadata(model_name, provider, model_settings=None)

    return model_name, display_name, input_data, metadata


def _wrap_concrete_model_class(model_class: Any):
    """Wrap a concrete model class to trace its request methods."""
    if _is_patched(model_class):
        return

    async def model_request_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name, display_name, input_data, metadata = _build_model_class_input_and_metadata(instance, args, kwargs)

        with start_span(
            name=f"chat {display_name}",
            type=SpanTypeAttribute.LLM,
            input=input_data,
            metadata=_try_dict(metadata),
        ) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)
            end_time = time.time()

            output = _serialize_model_response(result)
            metrics = _extract_response_metrics(result, start_time, end_time)

            span.log(output=output, metrics=metrics)
            return result

    def model_request_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name, display_name, input_data, metadata = _build_model_class_input_and_metadata(instance, args, kwargs)

        return _ModelStreamWrapper(
            wrapped(*args, **kwargs),
            model_name,
            display_name,
            input_data,
            metadata,
        )

    wrap_function_wrapper(model_class, "request", model_request_wrapper)
    wrap_function_wrapper(model_class, "request_stream", model_request_stream_wrapper)
    model_class._braintrust_patched = True


class _ModelStreamWrapper(AbstractAsyncContextManager):
    """Wrapper for Model.request_stream() that adds nested tracing."""

    def __init__(self, stream_result: Any, model_name: str, display_name: str, input_data: Any, metadata: Any):
        self.stream_result = stream_result
        self.model_name = model_name
        self.display_name = display_name
        self.input_data = input_data
        self.metadata = metadata
        self.span = None
        self.start_time = None

    async def __aenter__(self):
        self.span = start_span(
            name=f"chat {self.display_name}",
            type=SpanTypeAttribute.LLM,
            input=self.input_data,
            metadata=_try_dict(self.metadata),
        ).__enter__()

        self.start_time = time.time()
        self.stream = await self.stream_result.__aenter__()
        return self.stream

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        try:
            await self.stream_result.__aexit__(exc_type, exc_val, exc_tb)
        finally:
            if self.span and self.start_time:
                end_time = time.time()

                try:
                    final_response = self.stream.get()
                    output = _serialize_model_response(final_response)
                    metrics = _extract_response_metrics(final_response, self.start_time, end_time)
                    self.span.log(output=output, metrics=metrics)
                except Exception as e:
                    logger.debug(f"Failed to extract stream output/metrics: {e}")

                self.span.__exit__(None, None, None)

        return False


class _StreamContextWrapper(AbstractAsyncContextManager):
    """Wrapper for direct API stream context manager that adds tracing."""

    def __init__(self, stream_cm: Any, input_data: Any, metadata: Any):
        self.stream_cm = stream_cm
        self.input_data = input_data
        self.metadata = metadata
        self.span = None
        self.start_time = None
        self.first_token_time = None

    async def __aenter__(self):
        self.span = start_span(
            name="model_request_stream",
            type=SpanTypeAttribute.LLM,
            input=self.input_data,
            metadata=_try_dict(self.metadata),
        ).__enter__()

        self.start_time = time.time()
        self.stream = await self.stream_cm.__aenter__()
        return self.stream

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        try:
            await self.stream_cm.__aexit__(exc_type, exc_val, exc_tb)
        finally:
            if self.span and self.start_time:
                end_time = time.time()

                output = _serialize_model_response(self.stream.get())
                metrics = _extract_response_metrics(self.stream.get(), self.start_time, end_time, self.first_token_time)

                self.span.log(output=output, metrics=metrics)
                self.span.__exit__(None, None, None)

        return False


class _StreamedRunContextWrapper(AbstractAsyncContextManager):
    """Wrapper for Agent stream context manager that adds tracing."""

    def __init__(self, stream_cm: Any, input_data: Any, metadata: Any, agent_name: Optional[str]):
        self.stream_cm = stream_cm
        self.input_data = input_data
        self.metadata = metadata
        self.agent_name = agent_name
        self.span = None
        self.start_time = None
        self.first_token_time = None
        self.stream_result = None

    async def __aenter__(self):
        span_name = f"agent_run_stream [{self.agent_name}]" if self.agent_name else "agent_run_stream"
        self.span = start_span(
            name=span_name,
            type=SpanTypeAttribute.LLM,
            input=self.input_data,
            metadata=_try_dict(self.metadata),
        ).__enter__()

        self.start_time = time.time()
        self.stream_result = await self.stream_cm.__aenter__()
        return self.stream_result

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        try:
            await self.stream_cm.__aexit__(exc_type, exc_val, exc_tb)
        finally:
            if self.span and self.start_time and self.stream_result:
                end_time = time.time()

                output = _serialize_stream_output(self.stream_result)
                metrics = _extract_stream_usage_metrics(self.stream_result, self.start_time, end_time, self.first_token_time)

                self.span.log(output=output, metrics=metrics)
                self.span.__exit__(None, None, None)

        return False


class _StreamContextWrapperSync:
    """Wrapper for direct API sync stream context manager that adds tracing."""

    def __init__(self, stream_cm: Any, input_data: Any, metadata: Any):
        self.stream_cm = stream_cm
        self.input_data = input_data
        self.metadata = metadata
        self.span = None
        self.start_time = None
        self.first_token_time = None

    def __enter__(self):
        self.span = start_span(
            name="model_request_stream_sync",
            type=SpanTypeAttribute.LLM,
            input=self.input_data,
            metadata=_try_dict(self.metadata),
        ).__enter__()

        self.start_time = time.time()
        self.stream = self.stream_cm.__enter__()
        return self.stream

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            self.stream_cm.__exit__(exc_type, exc_val, exc_tb)
        finally:
            if self.span and self.start_time:
                end_time = time.time()

                output = _serialize_model_response(self.stream.get())
                metrics = _extract_response_metrics(self.stream.get(), self.start_time, end_time, self.first_token_time)

                self.span.log(output=output, metrics=metrics)
                self.span.__exit__(None, None, None)

        return False


class _StreamedRunContextWrapperSync:
    """Wrapper for Agent sync stream context manager that adds tracing."""

    def __init__(self, stream_cm: Any, input_data: Any, metadata: Any, agent_name: Optional[str]):
        self.stream_cm = stream_cm
        self.input_data = input_data
        self.metadata = metadata
        self.agent_name = agent_name
        self.span = None
        self.start_time = None
        self.first_token_time = None
        self.stream_result = None

    def __enter__(self):
        span_name = f"agent_run_stream_sync [{self.agent_name}]" if self.agent_name else "agent_run_stream_sync"
        self.span = start_span(
            name=span_name,
            type=SpanTypeAttribute.LLM,
            input=self.input_data,
            metadata=_try_dict(self.metadata),
        ).__enter__()

        self.start_time = time.time()
        self.stream_result = self.stream_cm.__enter__()
        return self.stream_result

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            self.stream_cm.__exit__(exc_type, exc_val, exc_tb)
        finally:
            if self.span and self.start_time and self.stream_result:
                end_time = time.time()

                output = _serialize_stream_output(self.stream_result)
                metrics = _extract_stream_usage_metrics(self.stream_result, self.start_time, end_time, self.first_token_time)

                self.span.log(output=output, metrics=metrics)
                self.span.__exit__(None, None, None)

        return False


def _serialize_user_prompt(user_prompt: Any) -> Any:
    """Serialize user prompt, handling BinaryContent and other types."""
    if user_prompt is None:
        return None

    if isinstance(user_prompt, str):
        return user_prompt

    if isinstance(user_prompt, list):
        return [_serialize_content_part(part) for part in user_prompt]

    return _serialize_content_part(user_prompt)


def _serialize_content_part(part: Any) -> Any:
    """Serialize a content part, handling BinaryContent specially."""
    if part is None:
        return None

    if hasattr(part, "data") and hasattr(part, "media_type") and hasattr(part, "kind"):
        if part.kind == "binary":
            data = part.data
            media_type = part.media_type

            extension = media_type.split("/")[1] if "/" in media_type else "bin"
            filename = f"file.{extension}"

            attachment = Attachment(data=data, filename=filename, content_type=media_type)
            return {"type": "binary", "attachment": attachment, "media_type": media_type}

    if isinstance(part, str):
        return part

    return _try_dict(part)


def _serialize_messages(messages: Any) -> Any:
    """Serialize messages list."""
    if not messages:
        return []

    result = []
    for msg in messages:
        serialized_msg = _try_dict(msg)

        if isinstance(serialized_msg, dict) and "parts" in serialized_msg:
            serialized_msg["parts"] = [_serialize_content_part(p) for p in msg.parts]

        result.append(serialized_msg)

    return result


def _serialize_result_output(result: Any) -> Any:
    """Serialize agent run result output."""
    if not result:
        return None

    output_dict = {}

    if hasattr(result, "output"):
        output_dict["output"] = _try_dict(result.output)

    if hasattr(result, "response"):
        output_dict["response"] = _serialize_model_response(result.response)

    return output_dict if output_dict else _try_dict(result)


def _serialize_stream_output(stream_result: Any) -> Any:
    """Serialize stream result output."""
    if not stream_result:
        return None

    output_dict = {}

    if hasattr(stream_result, "response"):
        output_dict["response"] = _serialize_model_response(stream_result.response)

    return output_dict if output_dict else None


def _serialize_model_response(response: Any) -> Any:
    """Serialize a model response."""
    if not response:
        return None

    response_dict = _try_dict(response)

    if isinstance(response_dict, dict) and "parts" in response_dict:
        if hasattr(response, "parts"):
            response_dict["parts"] = [_serialize_content_part(p) for p in response.parts]

    return response_dict


def _extract_model_info_from_model_instance(model: Any) -> tuple[Optional[str], Optional[str]]:
    """Extract model name and provider from a model instance.

    Args:
        model: A Pydantic AI model instance (OpenAIChatModel, AnthropicModel, etc.)

    Returns:
        Tuple of (model_name, provider)
    """
    if not model:
        return None, None

    if isinstance(model, str):
        return _parse_model_string(model)

    if hasattr(model, "model_name"):
        model_name = model.model_name
        class_name = type(model).__name__
        provider = None
        if "OpenAI" in class_name:
            provider = "openai"
        elif "Anthropic" in class_name:
            provider = "anthropic"
        elif "Gemini" in class_name:
            provider = "gemini"
        elif "Groq" in class_name:
            provider = "groq"
        elif "Mistral" in class_name:
            provider = "mistral"
        elif "VertexAI" in class_name:
            provider = "vertexai"

        return model_name, provider

    if hasattr(model, "name"):
        return _parse_model_string(model.name)

    return None, None


def _extract_model_info(agent: Any) -> tuple[Optional[str], Optional[str]]:
    """Extract model name and provider from agent.

    Args:
        agent: A Pydantic AI Agent instance

    Returns:
        Tuple of (model_name, provider)
    """
    if not hasattr(agent, "model"):
        return None, None

    return _extract_model_info_from_model_instance(agent.model)


def _build_model_metadata(model_name: Optional[str], provider: Optional[str], model_settings: Any = None) -> Dict[str, Any]:
    """Build metadata dictionary with model info.

    Args:
        model_name: The model name (e.g., "gpt-4o")
        provider: The provider (e.g., "openai")
        model_settings: Optional model settings to include

    Returns:
        Dictionary of metadata
    """
    metadata = {}
    if model_name:
        metadata["model"] = model_name
    if provider:
        metadata["provider"] = provider
    if model_settings:
        metadata["model_settings"] = _try_dict(model_settings)
    return metadata


def _parse_model_string(model: Any) -> tuple[Optional[str], Optional[str]]:
    """Parse model string to extract provider and model name.

    Pydantic AI uses format: "provider:model-name" (e.g., "openai:gpt-4o")
    """
    if not model:
        return None, None

    model_str = str(model)

    if ":" in model_str:
        parts = model_str.split(":", 1)
        return parts[1], parts[0]  # (model_name, provider)

    return model_str, None


def _extract_usage_metrics(result: Any, start_time: float, end_time: float) -> Optional[Dict[str, float]]:
    """Extract usage metrics from agent run result."""
    metrics: Dict[str, float] = {}

    metrics["start"] = start_time
    metrics["end"] = end_time
    metrics["duration"] = end_time - start_time

    usage = None
    if hasattr(result, "response"):
        try:
            response = result.response
            if hasattr(response, "usage"):
                usage = response.usage
        except (AttributeError, ValueError):
            pass

    if usage is None and hasattr(result, "usage"):
        usage = result.usage

    if usage is None:
        return metrics

    if hasattr(usage, "input_tokens"):
        input_tokens = usage.input_tokens
        if input_tokens is not None:
            metrics["prompt_tokens"] = float(input_tokens)

    if hasattr(usage, "output_tokens"):
        output_tokens = usage.output_tokens
        if output_tokens is not None:
            metrics["completion_tokens"] = float(output_tokens)

    if hasattr(usage, "total_tokens"):
        total_tokens = usage.total_tokens
        if total_tokens is not None:
            metrics["tokens"] = float(total_tokens)

    if hasattr(usage, "cache_read_tokens") and usage.cache_read_tokens is not None:
        metrics["prompt_cached_tokens"] = float(usage.cache_read_tokens)

    if hasattr(usage, "cache_write_tokens") and usage.cache_write_tokens is not None:
        metrics["prompt_cache_creation_tokens"] = float(usage.cache_write_tokens)

    if hasattr(usage, "input_audio_tokens") and usage.input_audio_tokens is not None:
        metrics["prompt_audio_tokens"] = float(usage.input_audio_tokens)

    if hasattr(usage, "output_audio_tokens") and usage.output_audio_tokens is not None:
        metrics["completion_audio_tokens"] = float(usage.output_audio_tokens)

    if hasattr(usage, "details") and isinstance(usage.details, dict):
        details = usage.details

        if "reasoning_tokens" in details:
            metrics["completion_reasoning_tokens"] = float(details["reasoning_tokens"])

        if "cached_tokens" in details:
            metrics["prompt_cached_tokens"] = float(details["cached_tokens"])

    return metrics if metrics else None


def _extract_stream_usage_metrics(
    stream_result: Any, start_time: float, end_time: float, first_token_time: Optional[float]
) -> Optional[Dict[str, float]]:
    """Extract usage metrics from stream result."""
    metrics: Dict[str, float] = {}

    metrics["start"] = start_time
    metrics["end"] = end_time
    metrics["duration"] = end_time - start_time

    if first_token_time:
        metrics["time_to_first_token"] = first_token_time - start_time

    if hasattr(stream_result, "usage"):
        usage_func = stream_result.usage
        if callable(usage_func):
            usage = usage_func()
        else:
            usage = usage_func

        if usage:
            if hasattr(usage, "input_tokens") and usage.input_tokens is not None:
                metrics["prompt_tokens"] = float(usage.input_tokens)

            if hasattr(usage, "output_tokens") and usage.output_tokens is not None:
                metrics["completion_tokens"] = float(usage.output_tokens)

            if hasattr(usage, "total_tokens") and usage.total_tokens is not None:
                metrics["tokens"] = float(usage.total_tokens)

            if hasattr(usage, "cache_read_tokens") and usage.cache_read_tokens is not None:
                metrics["prompt_cached_tokens"] = float(usage.cache_read_tokens)

            if hasattr(usage, "cache_write_tokens") and usage.cache_write_tokens is not None:
                metrics["prompt_cache_creation_tokens"] = float(usage.cache_write_tokens)

    return metrics if metrics else None


def _extract_response_metrics(
    response: Any, start_time: float, end_time: float, first_token_time: Optional[float] = None
) -> Optional[Dict[str, float]]:
    """Extract metrics from model response."""
    metrics: Dict[str, float] = {}

    metrics["start"] = start_time
    metrics["end"] = end_time
    metrics["duration"] = end_time - start_time

    if first_token_time:
        metrics["time_to_first_token"] = first_token_time - start_time

    if hasattr(response, "usage") and response.usage:
        usage = response.usage

        if hasattr(usage, "input_tokens") and usage.input_tokens is not None:
            metrics["prompt_tokens"] = float(usage.input_tokens)

        if hasattr(usage, "output_tokens") and usage.output_tokens is not None:
            metrics["completion_tokens"] = float(usage.output_tokens)

        if hasattr(usage, "total_tokens") and usage.total_tokens is not None:
            metrics["tokens"] = float(usage.total_tokens)

        if hasattr(usage, "cache_read_tokens") and usage.cache_read_tokens is not None:
            metrics["prompt_cached_tokens"] = float(usage.cache_read_tokens)

        if hasattr(usage, "cache_write_tokens") and usage.cache_write_tokens is not None:
            metrics["prompt_cache_creation_tokens"] = float(usage.cache_write_tokens)

    return metrics if metrics else None


def _is_patched(obj: Any) -> bool:
    """Check if object is already patched."""
    return getattr(obj, "_braintrust_patched", False)


def _try_dict(obj: Any) -> Union[Iterable[Any], Dict[str, Any]]:
    """Try to convert object to dict, handling Pydantic models and circular references."""
    if hasattr(obj, "model_dump"):
        try:
            obj = obj.model_dump(exclude_none=True)
        except ValueError as e:
            if "Circular reference" in str(e):
                return {}
            raise

    if isinstance(obj, dict):
        return {k: _try_dict(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_try_dict(item) for item in obj]

    return obj


def _serialize_type(obj: Any) -> Any:
    """Serialize a type/class for logging, handling Pydantic models and other types.

    This is useful for output_type, toolsets, and similar type parameters.
    """
    # If it's a class/type, return its name
    if isinstance(obj, type):
        return obj.__name__

    # If it has a __name__ attribute (like functions, classes), use that
    if hasattr(obj, "__name__"):
        return obj.__name__

    # For sequences of types (like Union types or list of models)
    if isinstance(obj, (list, tuple)):
        return [_serialize_type(item) for item in obj]

    # Try standard serialization
    return _try_dict(obj)


G = TypeVar("G", bound=AsyncGenerator[Any, None])


class aclosing(AbstractAsyncContextManager[G]):
    """Context manager for closing async generators."""

    def __init__(self, async_generator: G):
        self.async_generator = async_generator

    async def __aenter__(self):
        return self.async_generator

    async def __aexit__(self, *exc_info: Any):
        try:
            await self.async_generator.aclose()
        except ValueError as e:
            if "was created in a different Context" not in str(e):
                raise
            else:
                logger.debug(
                    f"Suppressed ContextVar error during async cleanup: {e}. "
                    "This is expected when async generators yield across context boundaries."
                )


def _build_agent_input_and_metadata(args: Any, kwargs: Any, instance: Any) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Build input data and metadata for agent wrappers.

    Returns:
        Tuple of (input_data, metadata)
    """
    input_data = {}

    user_prompt = args[0] if len(args) > 0 else kwargs.get("user_prompt")
    if user_prompt is not None:
        input_data["user_prompt"] = _serialize_user_prompt(user_prompt)

    for key, value in kwargs.items():
        if key == "deps":
            continue
        elif key == "message_history":
            input_data[key] = _serialize_messages(value) if value is not None else None
        elif key in ("output_type", "toolsets"):
            # These often contain types/classes, use special serialization
            input_data[key] = _serialize_type(value) if value is not None else None
        else:
            input_data[key] = _try_dict(value) if value is not None else None

    if "model" in kwargs:
        model_name, provider = _parse_model_string(kwargs["model"])
    else:
        model_name, provider = _extract_model_info(instance)

    # Extract agent-level configuration for metadata
    # Only add to metadata if NOT explicitly passed in kwargs (those go in input)
    agent_model_settings = None
    if "model_settings" not in kwargs and hasattr(instance, "model_settings") and instance.model_settings is not None:
        agent_model_settings = instance.model_settings

    metadata = _build_model_metadata(model_name, provider, agent_model_settings)

    # Extract additional agent configuration (only if not passed as kwargs)
    if "name" not in kwargs and hasattr(instance, "name") and instance.name is not None:
        metadata["agent_name"] = instance.name

    if "end_strategy" not in kwargs and hasattr(instance, "end_strategy") and instance.end_strategy is not None:
        metadata["end_strategy"] = str(instance.end_strategy)

    # Extract output_type if set on agent and not passed as kwarg
    # output_type can be a Pydantic model, str, or other types that get converted to JSON schema
    if "output_type" not in kwargs and hasattr(instance, "output_type") and instance.output_type is not None:
        try:
            metadata["output_type"] = _serialize_type(instance.output_type)
        except Exception as e:
            logger.debug(f"Failed to extract output_type from agent: {e}")

    # Extract toolsets if set on agent and not passed as kwarg
    if "toolsets" not in kwargs and hasattr(instance, "toolsets"):
        try:
            toolsets = instance.toolsets
            if toolsets:
                # Convert toolsets to a list of tool names/ids for brevity
                metadata["toolsets"] = [
                    {"id": getattr(ts, "id", str(type(ts).__name__)), "label": getattr(ts, "label", None)}
                    for ts in toolsets
                ]
        except Exception as e:
            logger.debug(f"Failed to extract toolsets from agent: {e}")

    # Extract system_prompt from agent if not passed as kwarg
    # Note: Pydantic AI doesn't expose a public API for this, so we access the private _system_prompts
    # attribute. This is wrapped in try/except to gracefully handle if the internal structure changes.
    if "system_prompt" not in kwargs:
        try:
            if hasattr(instance, "_system_prompts") and instance._system_prompts:
                metadata["system_prompt"] = "\n\n".join(instance._system_prompts)
        except Exception as e:
            logger.debug(f"Failed to extract system_prompt from agent: {e}")

    return input_data, metadata

def _build_direct_model_input_and_metadata(args: Any, kwargs: Any) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Build input data and metadata for direct model request wrappers.

    Returns:
        Tuple of (input_data, metadata)
    """
    input_data = {}

    model = args[0] if len(args) > 0 else kwargs.get("model")
    if model is not None:
        input_data["model"] = str(model)

    messages = args[1] if len(args) > 1 else kwargs.get("messages", [])
    if messages:
        input_data["messages"] = _serialize_messages(messages)

    for key, value in kwargs.items():
        if key not in ["model", "messages"]:
            input_data[key] = _try_dict(value) if value is not None else None

    model_name, provider = _parse_model_string(model)
    metadata = _build_model_metadata(model_name, provider)

    return input_data, metadata
