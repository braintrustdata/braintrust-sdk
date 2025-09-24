"""
FunctionCallWrapper class for Braintrust-Agno function call observability.
"""

import time
from typing import Any, Callable, Dict

from braintrust import current_span
from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute

from .base import Operations, Wrapper


class FunctionCallWrapper(Wrapper):
    """Wrapper for Agno FunctionCall with Braintrust observability."""

    def __init__(self, function_call: Any, original_methods: dict = None):
        super().__init__(function_call)
        self.__function_call = function_call
        self.__original_methods = original_methods or {}

    def execute(self, *args, **kwargs):
        """Wrap the execute method."""
        original_method = self.__original_methods.get('execute', self.__function_call.execute)
        return self._trace_tool_call(original_method, Operations.EXECUTE, *args, **kwargs)

    async def aexecute(self, *args, **kwargs):
        """Wrap the aexecute method."""
        original_method = self.__original_methods.get('aexecute', self.__function_call.aexecute)
        return await self._trace_tool_call_async(original_method, Operations.AEXECUTE, *args, **kwargs)

    def _trace_tool_call(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace a synchronous tool call - create span context so nested calls work."""
        function_name = self._get_function_name()
        span_name = f"{function_name}.{operation_name}"

        input_data = self._extract_tool_input(*args, **kwargs)
        metadata = self._extract_tool_metadata()
        start_time = time.time()

        parent_span = current_span()

        span = None
        try:
            span = start_span(
                name=span_name,
                span_attributes={"type": SpanTypeAttribute.TOOL},
                input=input_data,
                metadata=metadata,
                parent=parent_span.export() if parent_span else None
            )
        except Exception:
            pass

        try:
            if hasattr(wrapped_method, '__self__'):
                result = wrapped_method(*args, **kwargs)
            else:
                result = wrapped_method(self.__function_call, *args, **kwargs)
        except Exception as e:
            if span:
                self._safe_trace(lambda: span.log(error=str(e)))
                self._safe_trace(lambda: span.end())
            raise

        if span:
            self._safe_trace(lambda: span.log(
                output=self._extract_tool_output(result),
                metrics={"duration": time.time() - start_time}
            ))
            self._safe_trace(lambda: span.end())

        return result

    async def _trace_tool_call_async(self, wrapped_method: Callable, operation_name: str, *args, **kwargs):
        """Trace an asynchronous tool call - create span context so nested calls work."""
        function_name = self._get_function_name()
        span_name = f"{function_name}.{operation_name}"

        input_data = self._extract_tool_input(*args, **kwargs)
        metadata = self._extract_tool_metadata()
        start_time = time.time()

        parent_span = current_span()

        span = None
        try:
            span = start_span(
                name=span_name,
                span_attributes={"type": SpanTypeAttribute.TOOL},
                input=input_data,
                metadata=metadata,
                parent=parent_span.export() if parent_span else None
            )
        except Exception:
            pass

        try:
            if hasattr(wrapped_method, '__self__'):
                result = await wrapped_method(*args, **kwargs)
            else:
                result = await wrapped_method(self.__function_call, *args, **kwargs)
        except Exception as e:
            if span:
                self._safe_trace(lambda: span.log(error=str(e)))
                self._safe_trace(lambda: span.end())
            raise

        if span:
            self._safe_trace(lambda: span.log(
                output=self._extract_tool_output(result),
                metrics={"duration": time.time() - start_time}
            ))
            self._safe_trace(lambda: span.end())

        return result

    def _extract_tool_input(self, *args, **kwargs) -> Any:
        """Extract input data from function call."""
        if hasattr(self.__function_call, 'arguments'):
            return self.__function_call.arguments
        return {}

    def _extract_tool_metadata(self) -> Dict[str, Any]:
        """Extract metadata about the function."""
        metadata = {"provider": "agno"}

        function_name = self._get_function_name()
        if function_name != "Unknown":
            metadata["function_name"] = function_name

        if hasattr(self.__function_call, 'function') and hasattr(self.__function_call.function, 'description'):
            metadata["function_description"] = self.__function_call.function.description

        # Add OpenAI-compatible tool metadata for better Braintrust display
        if hasattr(self.__function_call, 'id'):
            metadata["tool_call_id"] = self.__function_call.id

        return metadata

    def _get_function_name(self) -> str:
        """Get the function name."""
        if hasattr(self.__function_call, 'function') and hasattr(self.__function_call.function, 'name'):
            return self.__function_call.function.name
        return "Unknown"

    def _extract_tool_output(self, result: Any) -> Any:
        """Extract output from function execution result."""
        if hasattr(result, 'status') and result.status == "success":
            if hasattr(self.__function_call, 'result'):
                return self.__function_call.result
        elif hasattr(result, 'status') and result.status == "failure":
            if hasattr(self.__function_call, 'error'):
                return {"error": self.__function_call.error}

        return str(result)

    def _extract_tool_metrics(self, result: Any) -> Dict[str, Any]:
        """Extract metrics from tool execution result."""
        metrics = {}

        # Basic execution metrics
        if isinstance(result, str) and len(result) > 0:
            metrics['output_length'] = len(result)
        elif result is not None:
            metrics['result_type'] = type(result).__name__

        return metrics if metrics else None
