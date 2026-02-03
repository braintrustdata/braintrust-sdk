import asyncio
import logging
import sys
import time
from contextlib import AbstractAsyncContextManager
from typing import Any

from braintrust.bt_json import bt_safe_deep_copy
from braintrust.logger import NOOP_SPAN, Attachment, current_span, init_logger, start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

logger = logging.getLogger(__name__)

__all__ = ["setup_pydantic_ai"]


def setup_pydantic_ai(
    api_key: str | None = None,
    project_id: str | None = None,
    project_name: str | None = None,
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
        import pydantic_ai.direct as direct_module
        from pydantic_ai import Agent

        Agent = wrap_agent(Agent)

        wrap_function_wrapper(direct_module, "model_request", _create_direct_model_request_wrapper())
        wrap_function_wrapper(direct_module, "model_request_sync", _create_direct_model_request_sync_wrapper())
        wrap_function_wrapper(direct_module, "model_request_stream", _create_direct_model_request_stream_wrapper())
        wrap_function_wrapper(
            direct_module, "model_request_stream_sync", _create_direct_model_request_stream_sync_wrapper()
        )

        wrap_model_classes()

        return True
    except ImportError:
        # Not installed - this is expected when using auto_instrument()
        return False


def wrap_agent(Agent: Any) -> Any:
    if _is_patched(Agent):
        return Agent

    def _ensure_model_wrapped(instance: Any):
        """Ensure the agent's model class is wrapped (lazy wrapping)."""
        if hasattr(instance, "_model"):
            model_class = type(instance._model)
            _wrap_concrete_model_class(model_class)

    async def agent_run_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        _ensure_model_wrapped(instance)
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)

        with start_span(
            name=f"agent_run [{instance.name}]" if hasattr(instance, "name") and instance.name else "agent_run",
            type=SpanTypeAttribute.LLM,
            input=input_data if input_data else None,
            metadata=metadata,
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
        _ensure_model_wrapped(instance)
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)

        with start_span(
            name=f"agent_run_sync [{instance.name}]"
            if hasattr(instance, "name") and instance.name
            else "agent_run_sync",
            type=SpanTypeAttribute.LLM,
            input=input_data if input_data else None,
            metadata=metadata,
        ) as agent_span:
            start_time = time.time()
            result = wrapped(*args, **kwargs)
            end_time = time.time()

            output = _serialize_result_output(result)
            metrics = _extract_usage_metrics(result, start_time, end_time)

            agent_span.log(output=output, metrics=metrics)
            return result

    wrap_function_wrapper(Agent, "run_sync", agent_run_sync_wrapper)

    def agent_run_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        _ensure_model_wrapped(instance)
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)
        agent_name = instance.name if hasattr(instance, "name") else None
        span_name = f"agent_run_stream [{agent_name}]" if agent_name else "agent_run_stream"

        return _AgentStreamWrapper(
            wrapped(*args, **kwargs),
            span_name,
            input_data,
            metadata,
        )

    wrap_function_wrapper(Agent, "run_stream", agent_run_stream_wrapper)

    def agent_run_stream_sync_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        _ensure_model_wrapped(instance)
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)
        agent_name = instance.name if hasattr(instance, "name") else None
        span_name = f"agent_run_stream_sync [{agent_name}]" if agent_name else "agent_run_stream_sync"

        # Create span context BEFORE calling wrapped function so internal spans nest under it
        span_cm = start_span(
            name=span_name,
            type=SpanTypeAttribute.LLM,
            input=input_data if input_data else None,
            metadata=metadata,
        )
        span = span_cm.__enter__()
        start_time = time.time()

        try:
            # Call the original function within the span context
            stream_result = wrapped(*args, **kwargs)
            return _AgentStreamResultSyncProxy(
                stream_result,
                span,
                span_cm,
                start_time,
            )
        except Exception:
            # Clean up span on error
            span_cm.__exit__(*sys.exc_info())
            raise

    wrap_function_wrapper(Agent, "run_stream_sync", agent_run_stream_sync_wrapper)

    async def agent_run_stream_events_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        _ensure_model_wrapped(instance)
        input_data, metadata = _build_agent_input_and_metadata(args, kwargs, instance)

        agent_name = instance.name if hasattr(instance, "name") else None
        span_name = f"agent_run_stream_events [{agent_name}]" if agent_name else "agent_run_stream_events"

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.LLM,
            input=input_data if input_data else None,
            metadata=metadata,
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
            metrics = {
                "start": start_time,
                "end": end_time,
                "duration": end_time - start_time,
                "event_count": event_count,
            }

            if final_result:
                output = _serialize_result_output(final_result)
                usage_metrics = _extract_usage_metrics(final_result, start_time, end_time)
                metrics.update(usage_metrics)

            agent_span.log(output=output, metrics=metrics)

    wrap_function_wrapper(Agent, "run_stream_events", agent_run_stream_events_wrapper)

    Agent._braintrust_patched = True

    return Agent


def _create_direct_model_request_wrapper():
    """Create wrapper for direct.model_request()."""

    async def wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)

        with start_span(
            name="model_request",
            type=SpanTypeAttribute.LLM,
            input=input_data,
            metadata=metadata,
        ) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)
            end_time = time.time()

            output = _serialize_model_response(result)
            metrics = _extract_response_metrics(result, start_time, end_time)

            span.log(output=output, metrics=metrics)
            return result

    return wrapper


def _create_direct_model_request_sync_wrapper():
    """Create wrapper for direct.model_request_sync()."""

    def wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)

        with start_span(
            name="model_request_sync",
            type=SpanTypeAttribute.LLM,
            input=input_data,
            metadata=metadata,
        ) as span:
            start_time = time.time()
            result = wrapped(*args, **kwargs)
            end_time = time.time()

            output = _serialize_model_response(result)
            metrics = _extract_response_metrics(result, start_time, end_time)

            span.log(output=output, metrics=metrics)
            return result

    return wrapper


def _create_direct_model_request_stream_wrapper():
    """Create wrapper for direct.model_request_stream()."""

    def wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)

        return _DirectStreamWrapper(
            wrapped(*args, **kwargs),
            "model_request_stream",
            input_data,
            metadata,
        )

    return wrapper


def _create_direct_model_request_stream_sync_wrapper():
    """Create wrapper for direct.model_request_stream_sync()."""

    def wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)

        return _DirectStreamWrapperSync(
            wrapped(*args, **kwargs),
            "model_request_stream_sync",
            input_data,
            metadata,
        )

    return wrapper


def wrap_model_request(original_func: Any) -> Any:
    async def wrapper(*args, **kwargs):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)

        with start_span(
            name="model_request",
            type=SpanTypeAttribute.LLM,
            input=input_data,
            metadata=metadata,
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
            metadata=metadata,
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

        return _DirectStreamWrapper(
            original_func(*args, **kwargs),
            "model_request_stream",
            input_data,
            metadata,
        )

    return wrapper


def wrap_model_request_stream_sync(original_func: Any) -> Any:
    def wrapper(*args, **kwargs):
        input_data, metadata = _build_direct_model_input_and_metadata(args, kwargs)

        return _DirectStreamWrapperSync(
            original_func(*args, **kwargs),
            "model_request_stream_sync",
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
    display_name = model_name or type(instance).__name__

    messages = args[0] if len(args) > 0 else kwargs.get("messages")
    model_settings = args[1] if len(args) > 1 else kwargs.get("model_settings")

    serialized_messages = _serialize_messages(messages)

    input_data = {"messages": serialized_messages}
    if model_settings is not None:
        input_data["model_settings"] = bt_safe_deep_copy(model_settings)

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
            metadata=metadata,
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

        return _DirectStreamWrapper(
            wrapped(*args, **kwargs),
            f"chat {display_name}",
            input_data,
            metadata,
        )

    wrap_function_wrapper(model_class, "request", model_request_wrapper)
    wrap_function_wrapper(model_class, "request_stream", model_request_stream_wrapper)
    model_class._braintrust_patched = True


class _AgentStreamWrapper(AbstractAsyncContextManager):
    """Wrapper for agent.run_stream() that adds tracing while passing through the stream result."""

    def __init__(self, stream_cm: Any, span_name: str, input_data: Any, metadata: Any):
        self.stream_cm = stream_cm
        self.span_name = span_name
        self.input_data = input_data
        self.metadata = metadata
        self.span_cm = None
        self.start_time = None
        self.stream_result = None
        self._enter_task = None
        self._first_token_time = None

    async def __aenter__(self):
        self._enter_task = asyncio.current_task()

        # Use context manager properly so span stays current
        # DON'T pass start_time here - we'll set it via metrics in __aexit__
        self.span_cm = start_span(
            name=self.span_name,
            type=SpanTypeAttribute.LLM,
            input=self.input_data if self.input_data else None,
            metadata=self.metadata,
        )
        self.span_cm.__enter__()

        # Capture start time right before entering the stream (API call initiation)
        self.start_time = time.time()
        self.stream_result = await self.stream_cm.__aenter__()

        # Wrap the stream result to capture first token time
        return _StreamResultProxy(self.stream_result, self)

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        try:
            await self.stream_cm.__aexit__(exc_type, exc_val, exc_tb)
        finally:
            if self.span_cm and self.start_time and self.stream_result:
                end_time = time.time()

                output = _serialize_stream_output(self.stream_result)
                metrics = _extract_stream_usage_metrics(
                    self.stream_result, self.start_time, end_time, self._first_token_time
                )
                self.span_cm.log(output=output, metrics=metrics)

            # Clean up span context
            if self.span_cm:
                if asyncio.current_task() is self._enter_task:
                    self.span_cm.__exit__(None, None, None)
                else:
                    self.span_cm.end()

        return False


class _StreamResultProxy:
    """Proxy for stream result that captures first token time."""

    def __init__(self, stream_result: Any, wrapper: _AgentStreamWrapper):
        self._stream_result = stream_result
        self._wrapper = wrapper

    def __getattr__(self, name: str):
        """Delegate all attribute access to the wrapped stream result."""
        attr = getattr(self._stream_result, name)

        # Wrap streaming methods to capture first token time
        if callable(attr) and name in ("stream_text", "stream_output"):

            async def wrapped_method(*args, **kwargs):
                result = attr(*args, **kwargs)
                async for item in result:
                    if self._wrapper._first_token_time is None:
                        self._wrapper._first_token_time = time.time()
                    yield item

            return wrapped_method

        return attr


class _DirectStreamWrapper(AbstractAsyncContextManager):
    """Wrapper for model_request_stream() that adds tracing while passing through the stream."""

    def __init__(self, stream_cm: Any, span_name: str, input_data: Any, metadata: Any):
        self.stream_cm = stream_cm
        self.span_name = span_name
        self.input_data = input_data
        self.metadata = metadata
        self.span_cm = None
        self.start_time = None
        self.stream = None
        self._enter_task = None
        self._first_token_time = None

    async def __aenter__(self):
        self._enter_task = asyncio.current_task()

        # Use context manager properly so span stays current
        # DON'T pass start_time here - we'll set it via metrics in __aexit__
        self.span_cm = start_span(
            name=self.span_name,
            type=SpanTypeAttribute.LLM,
            input=self.input_data if self.input_data else None,
            metadata=self.metadata,
        )
        self.span_cm.__enter__()

        # Capture start time right before entering the stream (API call initiation)
        self.start_time = time.time()
        self.stream = await self.stream_cm.__aenter__()

        # Wrap the stream to capture first token time
        return _DirectStreamIteratorProxy(self.stream, self)

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        try:
            await self.stream_cm.__aexit__(exc_type, exc_val, exc_tb)
        finally:
            if self.span_cm and self.start_time and self.stream:
                end_time = time.time()

                try:
                    final_response = self.stream.get()
                    output = _serialize_model_response(final_response)
                    metrics = _extract_response_metrics(
                        final_response, self.start_time, end_time, self._first_token_time
                    )
                    self.span_cm.log(output=output, metrics=metrics)
                except Exception as e:
                    logger.debug(f"Failed to extract stream output/metrics: {e}")

            # Clean up span context
            if self.span_cm:
                if asyncio.current_task() is self._enter_task:
                    self.span_cm.__exit__(None, None, None)
                else:
                    self.span_cm.end()

        return False


class _DirectStreamIteratorProxy:
    """Proxy for direct stream that captures first token time."""

    def __init__(self, stream: Any, wrapper: _DirectStreamWrapper):
        self._stream = stream
        self._wrapper = wrapper
        self._iterator = None

    def __getattr__(self, name: str):
        """Delegate all attribute access to the wrapped stream."""
        return getattr(self._stream, name)

    def __aiter__(self):
        """Return async iterator that captures first token time."""
        # Get the actual async iterator from the stream
        self._iterator = self._stream.__aiter__() if hasattr(self._stream, "__aiter__") else self._stream
        return self

    async def __anext__(self):
        """Capture first token time on first iteration."""
        if self._iterator is None:
            # In case __aiter__ wasn't called, initialize it
            self._iterator = self._stream.__aiter__() if hasattr(self._stream, "__aiter__") else self._stream

        item = await self._iterator.__anext__()
        if self._wrapper._first_token_time is None:
            self._wrapper._first_token_time = time.time()
        return item


class _AgentStreamResultSyncProxy:
    """Proxy for agent.run_stream_sync() result that adds tracing while delegating to actual stream result."""

    def __init__(self, stream_result: Any, span: Any, span_cm: Any, start_time: float):
        self._stream_result = stream_result
        self._span = span
        self._span_cm = span_cm
        self._start_time = start_time
        self._logged = False
        self._finalize_on_del = True
        self._first_token_time = None

    def __getattr__(self, name: str):
        """Delegate all attribute access to the wrapped stream result."""
        attr = getattr(self._stream_result, name)

        # Wrap any method that returns an iterator to auto-finalize when exhausted
        if callable(attr) and name in ("stream_text", "stream_output", "__iter__"):

            def wrapped_method(*args, **kwargs):
                try:
                    iterator = attr(*args, **kwargs)
                    # If it's an iterator, wrap it
                    if hasattr(iterator, "__iter__") or hasattr(iterator, "__next__"):
                        try:
                            for item in iterator:
                                if self._first_token_time is None:
                                    self._first_token_time = time.time()
                                yield item
                        finally:
                            self._finalize()
                            self._finalize_on_del = False  # Don't finalize again in __del__
                    else:
                        return iterator
                except Exception:
                    self._finalize()
                    self._finalize_on_del = False
                    raise

            return wrapped_method

        return attr

    def _finalize(self):
        """Log metrics and close span."""
        if self._span and not self._logged and self._stream_result:
            try:
                end_time = time.time()
                output = _serialize_stream_output(self._stream_result)
                metrics = _extract_stream_usage_metrics(
                    self._stream_result, self._start_time, end_time, self._first_token_time
                )
                self._span.log(output=output, metrics=metrics)
                self._logged = True
            finally:
                try:
                    self._span_cm.__exit__(None, None, None)
                except Exception:
                    pass

    def __del__(self):
        """Ensure span is closed when proxy is destroyed."""
        if self._finalize_on_del:
            self._finalize()


class _DirectStreamWrapperSync:
    """Wrapper for model_request_stream_sync() that adds tracing while passing through the stream."""

    def __init__(self, stream_cm: Any, span_name: str, input_data: Any, metadata: Any):
        self.stream_cm = stream_cm
        self.span_name = span_name
        self.input_data = input_data
        self.metadata = metadata
        self.span_cm = None
        self.start_time = None
        self.stream = None
        self._first_token_time = None

    def __enter__(self):
        # Use context manager properly so span stays current
        # DON'T pass start_time here - we'll set it via metrics in __exit__
        self.span_cm = start_span(
            name=self.span_name,
            type=SpanTypeAttribute.LLM,
            input=self.input_data if self.input_data else None,
            metadata=self.metadata,
        )
        span = self.span_cm.__enter__()

        # Capture start time right before entering the stream (API call initiation)
        self.start_time = time.time()
        self.stream = self.stream_cm.__enter__()

        # Wrap the stream to capture first token time
        return _DirectStreamIteratorSyncProxy(self.stream, self)

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            self.stream_cm.__exit__(exc_type, exc_val, exc_tb)
        finally:
            if self.span_cm and self.start_time and self.stream:
                end_time = time.time()

                try:
                    final_response = self.stream.get()
                    output = _serialize_model_response(final_response)
                    metrics = _extract_response_metrics(
                        final_response, self.start_time, end_time, self._first_token_time
                    )
                    self.span_cm.log(output=output, metrics=metrics)
                except Exception as e:
                    logger.debug(f"Failed to extract stream output/metrics: {e}")

            # Always clean up span context
            if self.span_cm:
                self.span_cm.__exit__(None, None, None)

        return False


class _DirectStreamIteratorSyncProxy:
    """Proxy for direct stream (sync) that captures first token time."""

    def __init__(self, stream: Any, wrapper: _DirectStreamWrapperSync):
        self._stream = stream
        self._wrapper = wrapper
        self._iterator = None

    def __getattr__(self, name: str):
        """Delegate all attribute access to the wrapped stream."""
        return getattr(self._stream, name)

    def __iter__(self):
        """Return iterator that captures first token time."""
        # Get the actual iterator from the stream
        self._iterator = self._stream.__iter__() if hasattr(self._stream, "__iter__") else self._stream
        return self

    def __next__(self):
        """Capture first token time on first iteration."""
        if self._iterator is None:
            # In case __iter__ wasn't called, initialize it
            self._iterator = self._stream.__iter__() if hasattr(self._stream, "__iter__") else self._stream

        item = self._iterator.__next__()
        if self._wrapper._first_token_time is None:
            self._wrapper._first_token_time = time.time()
        return item


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
    """Serialize a content part, handling BinaryContent specially.

    This function handles:
    - BinaryContent: converts to Braintrust Attachment
    - Parts with nested content (UserPromptPart): recursively serializes content items
    - Strings: passes through unchanged
    - Other objects: converts to dict via model_dump
    """
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

    if hasattr(part, "content"):
        content = part.content
        if isinstance(content, list):
            serialized_content = [_serialize_content_part(item) for item in content]
            result = bt_safe_deep_copy(part)
            if isinstance(result, dict):
                result["content"] = serialized_content
            return result
        elif content is not None:
            serialized_content = _serialize_content_part(content)
            result = bt_safe_deep_copy(part)
            if isinstance(result, dict):
                result["content"] = serialized_content
            return result

    if isinstance(part, str):
        return part

    return bt_safe_deep_copy(part)


def _serialize_messages(messages: Any) -> Any:
    """Serialize messages list."""
    if not messages:
        return []

    result = []
    for msg in messages:
        if hasattr(msg, "parts") and msg.parts:
            original_parts = msg.parts
            serialized_parts = [_serialize_content_part(p) for p in original_parts]

            # Use model_dump with exclude to avoid serializing parts field prematurely
            if hasattr(msg, "model_dump"):
                try:
                    serialized_msg = msg.model_dump(exclude={"parts"}, exclude_none=True)
                except (TypeError, ValueError):
                    # If exclude parameter not supported, fall back to bt_safe_deep_copy
                    serialized_msg = bt_safe_deep_copy(msg)
            else:
                serialized_msg = bt_safe_deep_copy(msg)

            if isinstance(serialized_msg, dict):
                serialized_msg["parts"] = serialized_parts
        else:
            serialized_msg = bt_safe_deep_copy(msg)

        result.append(serialized_msg)

    return result


def _serialize_result_output(result: Any) -> Any:
    """Serialize agent run result output."""
    if not result:
        return None

    output_dict = {}

    if hasattr(result, "output"):
        output_dict["output"] = bt_safe_deep_copy(result.output)

    if hasattr(result, "response"):
        output_dict["response"] = _serialize_model_response(result.response)

    return output_dict if output_dict else bt_safe_deep_copy(result)


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

    response_dict = bt_safe_deep_copy(response)

    if hasattr(response, "parts") and isinstance(response_dict, dict):
        response_dict["parts"] = [_serialize_content_part(p) for p in response.parts]

    return response_dict


def _extract_model_info_from_model_instance(model: Any) -> tuple[str | None, str | None]:
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


def _extract_model_info(agent: Any) -> tuple[str | None, str | None]:
    """Extract model name and provider from agent.

    Args:
        agent: A Pydantic AI Agent instance

    Returns:
        Tuple of (model_name, provider)
    """
    if not hasattr(agent, "model"):
        return None, None

    return _extract_model_info_from_model_instance(agent.model)


def _build_model_metadata(model_name: str | None, provider: str | None, model_settings: Any = None) -> dict[str, Any]:
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
        metadata["model_settings"] = bt_safe_deep_copy(model_settings)
    return metadata


def _parse_model_string(model: Any) -> tuple[str | None, str | None]:
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


def _extract_usage_metrics(result: Any, start_time: float, end_time: float) -> dict[str, float] | None:
    """Extract usage metrics from agent run result."""
    metrics: dict[str, float] = {}

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
    stream_result: Any, start_time: float, end_time: float, first_token_time: float | None
) -> dict[str, float] | None:
    """Extract usage metrics from stream result."""
    metrics: dict[str, float] = {}

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
    response: Any, start_time: float, end_time: float, first_token_time: float | None = None
) -> dict[str, float] | None:
    """Extract metrics from model response."""
    metrics: dict[str, float] = {}

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

        # Extract reasoning tokens for reasoning models (o1/o3)
        if hasattr(usage, "details") and usage.details is not None:
            if hasattr(usage.details, "reasoning_tokens") and usage.details.reasoning_tokens is not None:
                metrics["completion_reasoning_tokens"] = float(usage.details.reasoning_tokens)

    return metrics if metrics else None


def _is_patched(obj: Any) -> bool:
    """Check if object is already patched."""
    return getattr(obj, "_braintrust_patched", False)


def _serialize_type(obj: Any) -> Any:
    """Serialize a type/class for logging, handling Pydantic models and other types.

    This is useful for output_type, toolsets, and similar type parameters.
    Returns full JSON schema for Pydantic models so engineers can see exactly
    what structured output schema was used.
    """
    import inspect

    # For sequences of types (like Union types or list of models)
    if isinstance(obj, (list, tuple)):
        return [_serialize_type(item) for item in obj]

    # Handle Pydantic AI's output wrappers (ToolOutput, NativeOutput, PromptedOutput, TextOutput)
    if hasattr(obj, "output"):
        # These are wrapper classes with an 'output' field containing the actual type
        wrapper_info = {"wrapper": type(obj).__name__}
        if hasattr(obj, "name") and obj.name:
            wrapper_info["name"] = obj.name
        if hasattr(obj, "description") and obj.description:
            wrapper_info["description"] = obj.description
        wrapper_info["output"] = _serialize_type(obj.output)
        return wrapper_info

    # If it's a Pydantic model class, return its full JSON schema
    if inspect.isclass(obj):
        try:
            from pydantic import BaseModel

            if issubclass(obj, BaseModel):
                # Return the full JSON schema - includes all field info, descriptions, constraints, etc.
                return obj.model_json_schema()
        except (ImportError, AttributeError, TypeError):
            pass

        # Not a Pydantic model, return class name
        return obj.__name__

    # If it has a __name__ attribute (like functions), use that
    if hasattr(obj, "__name__"):
        return obj.__name__

    # Try standard serialization
    return bt_safe_deep_copy(obj)


def _build_agent_input_and_metadata(args: Any, kwargs: Any, instance: Any) -> tuple[dict[str, Any], dict[str, Any]]:
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
        elif key == "model_settings":
            # model_settings passed to run() goes in INPUT (it's a run() parameter)
            input_data[key] = bt_safe_deep_copy(value) if value is not None else None
        else:
            input_data[key] = bt_safe_deep_copy(value) if value is not None else None

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
    # Toolsets go in INPUT (not metadata) because agent.run() accepts toolsets parameter
    if "toolsets" not in kwargs and hasattr(instance, "toolsets"):
        try:
            toolsets = instance.toolsets
            if toolsets:
                # Convert toolsets to a list with FULL tool schemas for input
                serialized_toolsets = []
                for ts in toolsets:
                    ts_info = {
                        "id": getattr(ts, "id", str(type(ts).__name__)),
                        "label": getattr(ts, "label", None),
                    }
                    # Add full tool schemas (not just names) since toolsets can be passed to agent.run()
                    if hasattr(ts, "tools") and ts.tools:
                        tools_list = []
                        tools_dict = ts.tools
                        # tools is a dict mapping tool name -> Tool object
                        for tool_name, tool_obj in tools_dict.items():
                            tool_dict = {
                                "name": tool_name,
                            }
                            # Extract description
                            if hasattr(tool_obj, "description") and tool_obj.description:
                                tool_dict["description"] = tool_obj.description
                            # Extract JSON schema for parameters
                            if hasattr(tool_obj, "function_schema") and hasattr(
                                tool_obj.function_schema, "json_schema"
                            ):
                                tool_dict["parameters"] = tool_obj.function_schema.json_schema
                            tools_list.append(tool_dict)
                        ts_info["tools"] = tools_list
                    serialized_toolsets.append(ts_info)
                input_data["toolsets"] = serialized_toolsets
        except Exception as e:
            logger.debug(f"Failed to extract toolsets from agent: {e}")

    # Extract system_prompt from agent if not passed as kwarg
    # Note: system_prompt goes in input (not metadata) because it's semantically part of the LLM input
    # Pydantic AI doesn't expose a public API for this, so we access the private _system_prompts
    # attribute. This is wrapped in try/except to gracefully handle if the internal structure changes.
    if "system_prompt" not in kwargs:
        try:
            if hasattr(instance, "_system_prompts") and instance._system_prompts:
                input_data["system_prompt"] = "\n\n".join(instance._system_prompts)
        except Exception as e:
            logger.debug(f"Failed to extract system_prompt from agent: {e}")

    return input_data, metadata


def _build_direct_model_input_and_metadata(args: Any, kwargs: Any) -> tuple[dict[str, Any], dict[str, Any]]:
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
            input_data[key] = bt_safe_deep_copy(value) if value is not None else None

    model_name, provider = _parse_model_string(model)
    metadata = _build_model_metadata(model_name, provider)

    return input_data, metadata
