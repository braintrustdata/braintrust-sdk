"""
ModelWrapper class for Braintrust-Agno model observability.
"""

from typing import Any, Callable, Dict

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute

from .base import Operations, Wrapper


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


class ModelWrapper(Wrapper):
    """Wrapper for Agno Model with Braintrust observability."""

    def __init__(self, model: Any, original_methods: dict = None):
        super().__init__(model)
        self.__model = model
        self.__original_methods = original_methods or {}

    def invoke(self, *args, **kwargs):
        original_method = self.__original_methods.get('invoke', self.__model.invoke)
        return self._trace_model_call(original_method, Operations.INVOKE, *args, **kwargs)

    async def ainvoke(self, *args, **kwargs):
        original_method = self.__original_methods.get('ainvoke', self.__model.ainvoke)
        return await self._trace_model_call_async(original_method, Operations.AINVOKE, *args, **kwargs)

    def invoke_stream(self, *args, **kwargs):
        original_method = self.__original_methods.get('invoke_stream', self.__model.invoke_stream)
        return self._trace_model_stream(original_method, Operations.INVOKE_STREAM, *args, **kwargs)

    async def ainvoke_stream(self, *args, **kwargs):
        original_method = self.__original_methods.get('ainvoke_stream', self.__model.ainvoke_stream)
        return await self._trace_model_stream_async(original_method, Operations.AINVOKE_STREAM, *args, **kwargs)

    def response(self, *args, **kwargs):
        original_method = self.__original_methods.get('response', self.__model.response)
        return self._trace_model_call(original_method, Operations.RESPONSE, *args, **kwargs)

    async def aresponse(self, *args, **kwargs):
        original_method = self.__original_methods.get('aresponse', self.__model.aresponse)
        return await self._trace_model_call_async(original_method, Operations.ARESPONSE, *args, **kwargs)

    def response_stream(self, *args, **kwargs):
        original_method = self.__original_methods.get('response_stream', self.__model.response_stream)
        return self._trace_model_stream(original_method, Operations.RESPONSE_STREAM, *args, **kwargs)

    async def aresponse_stream(self, *args, **kwargs):
        original_method = self.__original_methods.get('aresponse_stream', self.__model.aresponse_stream)
        return await self._trace_model_stream_async(original_method, Operations.ARESPONSE_STREAM, *args, **kwargs)

    def _trace_model_call(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace a synchronous model call - create span context for tool calls to nest under."""
        if hasattr(self.__model, 'get_provider') and callable(self.__model.get_provider):
            model_name = self.__model.get_provider()
        else:
            model_name = getattr(self.__model.__class__, '__name__', 'Model')
        span_name = f"{model_name}.{operation_name}"

        input_messages = self._extract_input_messages(*args, **kwargs)
        input_metadata = self._extract_input_metadata(*args, **kwargs)
        model_metadata = self._extract_model_metadata()
        # Combine input metadata with model metadata
        metadata = {**model_metadata, **input_metadata}

        span = None
        try:
            span = start_span(
                name=span_name,
                span_attributes={"type": SpanTypeAttribute.LLM},
                input=input_messages,
                metadata=metadata
            )
            span.set_current()

        except Exception:
            pass

        try:
            if hasattr(wrapped_method, '__self__'):
                result = wrapped_method(*args, **kwargs)
            else:
                result = wrapped_method(self.__model, *args, **kwargs)
        except Exception as e:
            if span:
                self._safe_trace(lambda: span.log(error=str(e)))
                self._safe_trace(lambda: span.end())
            raise

        if span:
            input_messages = self._extract_input_messages(*args, **kwargs)
            output_data = self._extract_output_data(result)
            self._safe_trace(lambda: span.log(
                input=input_messages,
                output=output_data,
                metrics=self._extract_model_metrics(result, kwargs.get('messages', []))
            ))
            self._safe_trace(lambda: span.end())

        return result

    async def _trace_model_call_async(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace an asynchronous model call - create span context for tool calls to nest under."""
        if hasattr(self.__model, 'get_provider') and callable(self.__model.get_provider):
            model_name = self.__model.get_provider()
        else:
            model_name = getattr(self.__model.__class__, '__name__', 'Model')
        span_name = f"{model_name}.{operation_name}"

        input_messages = self._extract_input_messages(*args, **kwargs)
        input_metadata = self._extract_input_metadata(*args, **kwargs)
        model_metadata = self._extract_model_metadata()
        metadata = {**model_metadata, **input_metadata}

        span = None
        try:
            span = start_span(
                name=span_name,
                span_attributes={"type": SpanTypeAttribute.LLM},
                input=input_messages,
                metadata=metadata
            )
            span.set_current()

        except Exception:
            pass

        try:
            if hasattr(wrapped_method, '__self__'):
                result = await wrapped_method(*args, **kwargs)
            else:
                result = await wrapped_method(self.__model, *args, **kwargs)
        except Exception as e:
            if span:
                self._safe_trace(lambda: span.log(error=str(e)))
                self._safe_trace(lambda: span.end())
            raise

        if span:
            input_messages = self._extract_input_messages(*args, **kwargs)
            output_data = self._extract_output_data(result)
            self._safe_trace(lambda: span.log(
                input=input_messages,
                output=output_data,
                metrics=self._extract_model_metrics(result, kwargs.get('messages', []))
            ))
            self._safe_trace(lambda: span.end())

        return result

    def _trace_model_stream(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace a synchronous model stream."""
        try:
            if hasattr(wrapped_method, '__self__'):
                stream = wrapped_method(*args, **kwargs)
            else:
                stream = wrapped_method(self.__model, *args, **kwargs)
        except Exception as e:
            self._safe_trace(lambda: self._trace_error(operation_name, str(e)))
            raise

        return self._wrap_model_stream(stream, operation_name, *args, **kwargs)

    async def _trace_model_stream_async(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace an asynchronous model stream."""
        try:
            stream = wrapped_method(*args, **kwargs)
        except Exception as e:
            self._safe_trace(lambda: self._trace_error(operation_name, str(e)))
            raise

        return self._wrap_model_stream_async(stream, operation_name, *args, **kwargs)

    def _wrap_model_stream(self, stream, operation_name: str, *args, **kwargs):
        """Wrap a model stream with tracing."""
        if hasattr(self.__model, 'get_provider') and callable(self.__model.get_provider):
            model_name = self.__model.get_provider()
        else:
            model_name = getattr(self.__model.__class__, '__name__', 'Model')
        span_name = f"{model_name}.{operation_name}"

        input_messages = self._extract_input_messages(*args, **kwargs)
        input_metadata = self._extract_input_metadata(*args, **kwargs)
        model_metadata = self._extract_model_metadata()
        # Combine input metadata with model metadata
        metadata = {**model_metadata, **input_metadata}

        def safe_stream_generator():
            span = None
            try:
                span = start_span(
                    name=span_name,
                    span_attributes={"type": SpanTypeAttribute.LLM},
                    input=input_messages,
                    metadata=metadata
                )
                if span:
                    span.set_current()
            except Exception:
                pass

            try:
                collected_output = []
                for chunk in stream:
                    yield chunk
                    if hasattr(chunk, 'content'):
                        collected_output.append(chunk.content)

                if span and collected_output:
                    self._safe_trace(lambda: span.log(output=''.join(collected_output)))

            except Exception as e:
                if span:
                    self._safe_trace(lambda: span.log(error=str(e)))
                raise
            finally:
                if span:
                    self._safe_trace(lambda: span.end())

        return safe_stream_generator()

    async def _wrap_model_stream_async(self, stream, operation_name: str, *args, **kwargs):
        """Wrap an async model stream with tracing."""
        if hasattr(self.__model, 'get_provider') and callable(self.__model.get_provider):
            model_name = self.__model.get_provider()
        else:
            model_name = getattr(self.__model.__class__, '__name__', 'Model')
        span_name = f"{model_name}.{operation_name}"

        input_messages = self._extract_input_messages(*args, **kwargs)
        input_metadata = self._extract_input_metadata(*args, **kwargs)
        model_metadata = self._extract_model_metadata()
        # Combine input metadata with model metadata
        metadata = {**model_metadata, **input_metadata}

        async def safe_async_stream_generator():
            span = None
            try:
                span = start_span(
                    name=span_name,
                    span_attributes={"type": SpanTypeAttribute.LLM},
                    input=input_messages,
                    metadata=metadata
                )
                if span:
                    span.set_current()
            except Exception:
                pass

            try:
                collected_output = []
                async for chunk in stream:
                    yield chunk
                    if hasattr(chunk, 'content'):
                        collected_output.append(chunk.content)

                if span and collected_output:
                    self._safe_trace(lambda: span.log(output=''.join(collected_output)))

            except Exception as e:
                if span:
                    self._safe_trace(lambda: span.log(error=str(e)))
                raise
            finally:
                if span:
                    self._safe_trace(lambda: span.end())

        return safe_async_stream_generator()

    def _extract_input_messages(self, *args, **kwargs) -> Any:
        """Extract messages with minimal fixes for Braintrust compatibility."""
        messages = kwargs.get('messages', [])
        if not isinstance(messages, list):
            return messages


        # Convert Agno message objects to dicts and fix content field
        fixed_messages = []
        for msg in messages:
            # Convert Pydantic model to dict
            if hasattr(msg, 'model_dump'):
                msg_dict = msg.model_dump()  # Pydantic v2
            elif hasattr(msg, 'dict'):
                msg_dict = msg.dict()  # Pydantic v1
            else:
                msg_dict = msg  # Already a dict

            # Fix content field if None (required for OpenAI compatibility)
            if msg_dict.get('content') is None:
                msg_dict['content'] = ""

            # Remove tool_calls if null/empty (Zod parser expects omission, not null)
            if msg_dict.get('tool_calls') in [None, [], ""]:
                msg_dict.pop('tool_calls', None)

            # Remove name if null (Zod parser expects omission, not null)
            if msg_dict.get('name') is None:
                msg_dict.pop('name', None)

            # Remove tool_call_id if null (should only be present on tool messages)
            if msg_dict.get('tool_call_id') is None:
                msg_dict.pop('tool_call_id', None)

            # Remove ALL null fields - Zod parser expects missing fields, not null
            keys_to_remove = [key for key, value in msg_dict.items() if value is None]
            for key in keys_to_remove:
                msg_dict.pop(key, None)

            fixed_messages.append(msg_dict)

        return fixed_messages


    def _extract_input_metadata(self, *args, **kwargs) -> dict:
        """Extract non-message fields for Braintrust metadata."""
        # Only include essential fields, excluding Agno-specific data that confuses Try Prompt
        allowed_fields = ['model', 'temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop']
        metadata = {k: v for k, v in kwargs.items()
                   if k in allowed_fields}

        # Don't add args or other Agno-specific data that causes Try Prompt conflicts
        return metadata

    def _extract_output_data(self, result) -> Any:
        """Extract output data with minimal fixes for Braintrust compatibility."""
        # Simplified output - just extract content and return minimal structure
        content = ""

        # Try to get content from various formats
        if hasattr(result, 'content'):
            content = result.content or ""
        elif isinstance(result, dict):
            content = result.get('content', "")
        elif hasattr(result, 'model_dump'):
            result_dict = result.model_dump()
            content = result_dict.get('content', "")
        elif hasattr(result, '__dict__'):
            content = getattr(result, 'content', "") or result.__dict__.get('content', "")

        # Return minimal OpenAI-compatible output
        return [{"role": "assistant", "content": content}]


    def _extract_model_metadata(self) -> Dict[str, Any]:
        """Extract metadata about the model."""
        metadata = {"component": "model"}

        if hasattr(self.__model, 'id') and self.__model.id:
            metadata['model'] = self.__model.id
            metadata['model_id'] = self.__model.id
        if hasattr(self.__model, 'provider') and self.__model.provider:
            metadata['provider'] = self.__model.provider
        if hasattr(self.__model, 'name') and self.__model.name:
            metadata['model_name'] = self.__model.name
        if hasattr(self.__model, '__class__'):
            metadata['model_class'] = self.__model.__class__.__name__

        return metadata

    def _extract_model_metrics(self, result: Any, messages: list = None) -> Dict[str, Any]:
        """Extract metrics from model response using standard Braintrust names."""
        # Try the original approach first (for backwards compatibility)
        if hasattr(result, 'response_usage') and result.response_usage:
            return _parse_metrics_from_agno(result.response_usage)

        # If no metrics found and we have messages, look for metrics in assistant messages
        if messages:
            for msg in messages:
                # Look for assistant messages with metrics
                if (hasattr(msg, 'role') and msg.role == 'assistant' and
                    hasattr(msg, 'metrics') and msg.metrics):
                    return _parse_metrics_from_agno(msg.metrics)

        return None
