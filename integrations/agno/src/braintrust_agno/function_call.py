from typing import Any, Dict

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

from braintrust_agno.utils import is_patched


def wrap_function_call(FunctionCall: Any) -> Any:
    if is_patched(FunctionCall):
        return FunctionCall

    def execute_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        function_name = _get_function_name(instance)
        span_name = f"{function_name}.execute"

        input_data = _extract_tool_input(instance, *args, **kwargs)
        metadata = _extract_tool_metadata(instance)

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TOOL,
            input=input_data,
            metadata=metadata,
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(output=_extract_tool_output(instance, result))
            return result

    if hasattr(FunctionCall, "execute"):
        wrap_function_wrapper(FunctionCall, "execute", execute_wrapper)

    async def aexecute_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        function_name = _get_function_name(instance)
        span_name = f"{function_name}.aexecute"

        input_data = _extract_tool_input(instance, *args, **kwargs)
        metadata = _extract_tool_metadata(instance)

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TOOL,
            input=input_data,
            metadata=metadata,
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(output=_extract_tool_output(instance, result))
            return result

    if hasattr(FunctionCall, "aexecute"):
        wrap_function_wrapper(FunctionCall, "aexecute", aexecute_wrapper)

    FunctionCall._braintrust_patched = True
    return FunctionCall


def _get_function_name(instance) -> str:
    if hasattr(instance, "function") and hasattr(instance.function, "name"):
        return instance.function.name
    return "Unknown"


def _extract_tool_input(instance, *args, **kwargs) -> Any:
    """Extract input data from function call."""
    if hasattr(instance, "arguments"):
        return instance.arguments
    return {}


def _extract_tool_metadata(instance) -> Dict[str, Any]:
    """Extract metadata about the function."""
    metadata = {"provider": "agno"}

    function_name = _get_function_name(instance)
    if function_name != "Unknown":
        metadata["function_name"] = function_name

    if hasattr(instance, "function") and hasattr(instance.function, "description"):
        metadata["function_description"] = instance.function.description

    # Add OpenAI-compatible tool metadata for better Braintrust display
    if hasattr(instance, "id"):
        metadata["tool_call_id"] = instance.id

    return metadata


def _extract_tool_output(instance, result: Any) -> Any:
    """Extract output from function execution result."""
    if hasattr(result, "status") and result.status == "success":
        if hasattr(instance, "result"):
            return instance.result
    elif hasattr(result, "status") and result.status == "failure":
        if hasattr(instance, "error"):
            return {"error": instance.error}

    return str(result)
