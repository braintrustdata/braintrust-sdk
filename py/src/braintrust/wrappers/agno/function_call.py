from typing import Any

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

from .utils import is_patched


def wrap_function_call(FunctionCall: Any) -> Any:
    if is_patched(FunctionCall):
        return FunctionCall

    def execute_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        function_name = _get_function_name(instance)
        span_name = f"{function_name}.execute"

        entrypoint_args = instance._build_entrypoint_args()

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TOOL,
            input=(instance.arguments or {}),
            metadata={
                "name": instance.function.name,
                "entrypoint": instance.function.entrypoint.__name__,
                **(entrypoint_args or {}),
            },
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(output=result)
            return result

    if hasattr(FunctionCall, "execute"):
        wrap_function_wrapper(FunctionCall, "execute", execute_wrapper)

    async def aexecute_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        function_name = _get_function_name(instance)
        span_name = f"{function_name}.aexecute"

        entrypoint_args = instance._build_entrypoint_args()

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TOOL,
            input=(instance.arguments or {}),
            metadata={
                "name": instance.function.name,
                "entrypoint": instance.function.entrypoint.__name__,
                **(entrypoint_args or {}),
            },
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(output=result)
            return result

    if hasattr(FunctionCall, "aexecute"):
        wrap_function_wrapper(FunctionCall, "aexecute", aexecute_wrapper)

    FunctionCall._braintrust_patched = True
    return FunctionCall


def _get_function_name(instance) -> str:
    if hasattr(instance, "function") and hasattr(instance.function, "name"):
        return instance.function.name
    return "Unknown"
