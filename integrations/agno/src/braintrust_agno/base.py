"""
Base wrapper class and common utilities for Braintrust-Agno integration.
"""

from typing import Any, Callable

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute


class Operations:
    """Operation names for Agno methods."""
    RUN = "run"
    PRINT_RESPONSE = "print_response"
    RUN_STREAM = "run_stream"
    INVOKE = "invoke"
    AINVOKE = "ainvoke"
    INVOKE_STREAM = "invoke_stream"
    AINVOKE_STREAM = "ainvoke_stream"
    RESPONSE = "response"
    ARESPONSE = "aresponse"
    RESPONSE_STREAM = "response_stream"
    ARESPONSE_STREAM = "aresponse_stream"
    EXECUTE = "execute"
    AEXECUTE = "aexecute"


class Wrapper:
    """Base wrapper class for Agno objects with Braintrust observability."""

    def __init__(self, wrapped_object: Any):
        self.__wrapped = wrapped_object

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped, name)

    def _safe_trace(self, operation: Callable):
        """Safely execute a tracing operation, catching any exceptions."""
        try:
            operation()
        except Exception:
            pass

    def _extract_output(self, result: Any) -> Any:
        """Extract meaningful output from various result types."""
        if result is None:
            return None

        if hasattr(result, 'content'):
            return result.content
        elif hasattr(result, 'choices') and result.choices:
            return result.choices[0].message.content if hasattr(result.choices[0], 'message') else result.choices[0]
        elif isinstance(result, str):
            return result
        elif isinstance(result, (dict, list)):
            return result
        else:
            return str(result)

    def _trace_success(self, span: Any, result: Any):
        """Log successful operation result to span."""
        if span:
            self._safe_trace(lambda: span.log(output=self._extract_output(result)))

    def _trace_error(self, operation_name: str, error: str):
        """Create an error span for failed operations."""
        self._safe_trace(lambda: self._create_error_span(operation_name, error))

    def _create_error_span(self, operation_name: str, error: str):
        """Create a simple error span."""
        with start_span(
            name=f"Error: {operation_name}",
            span_attributes={"type": SpanTypeAttribute.TASK}
        ) as span:
            span.log(input={"operation": operation_name}, output={"error": error})
