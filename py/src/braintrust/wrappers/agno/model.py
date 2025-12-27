"""
ModelWrapper class for Braintrust-Agno model observability.
"""

import time
from typing import Any

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

from .utils import (
    _aggregate_model_chunks,
    _aggregate_response_stream_chunks,
    extract_metadata,
    extract_metrics,
    extract_streaming_metrics,
    get_args_kwargs,
    is_patched,
    mark_patched,
)


def wrap_model(Model: Any) -> Any:
    if is_patched(Model):
        return Model

    def invoke_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.invoke"

        input, clean_kwargs = get_args_kwargs(
            args, kwargs, ["assistant_message", "messages", "response_format", "tools", "tool_choice"]
        )

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.LLM,
            input=input,
            metadata={
                **clean_kwargs,
                **extract_metadata(instance, "model"),
            },
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=extract_metrics(result, kwargs.get("messages", [])),
            )
            return result

    if hasattr(Model, "invoke"):
        wrap_function_wrapper(Model, "invoke", invoke_wrapper)

    async def ainvoke_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.ainvoke"

        input, clean_kwargs = get_args_kwargs(
            args, kwargs, ["messages", "assistant_message", "response_format", "tools", "tool_choice"]
        )

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.LLM,
            input=input,
            metadata={
                **clean_kwargs,
                **extract_metadata(instance, "model"),
            },
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=extract_metrics(result, kwargs.get("messages", [])),
            )
            return result

    if hasattr(Model, "ainvoke"):
        wrap_function_wrapper(Model, "ainvoke", ainvoke_wrapper)

    def invoke_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.invoke_stream"

        input, clean_kwargs = get_args_kwargs(
            args, kwargs, ["messages", "assistant_messages", "response_format", "tools", "tool_choice"]
        )

        def _trace_stream():
            start = time.time()
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.LLM,
                input=input,
                metadata={
                    **clean_kwargs,
                    **extract_metadata(instance, "model"),
                },
            ) as span:
                first = True
                collected_chunks = []
                for chunk in wrapped(*args, **kwargs):
                    if first:
                        span.log(
                            metrics={
                                "time_to_first_token": time.time() - start,
                            }
                        )
                        first = False

                    collected_chunks.append(chunk)
                    yield chunk

                aggregated = _aggregate_model_chunks(collected_chunks)

                span.log(
                    output=aggregated,
                    metrics=extract_streaming_metrics(aggregated, start),
                )

        return _trace_stream()

    if hasattr(Model, "invoke_stream"):
        wrap_function_wrapper(Model, "invoke_stream", invoke_stream_wrapper)

    def ainvoke_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.ainvoke_stream"

        input, clean_kwargs = get_args_kwargs(
            args, kwargs, ["messages", "assistant_messages", "response_format", "tools", "tool_choice"]
        )

        async def _trace_astream():
            start = time.time()
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.LLM,
                input=input,
                metadata={
                    **clean_kwargs,
                    **extract_metadata(instance, "model"),
                },
            ) as span:
                first = True
                collected_chunks = []
                async for chunk in wrapped(*args, **kwargs):
                    if first:
                        span.log(
                            metrics={
                                "time_to_first_token": time.time() - start,
                            }
                        )
                        first = False

                    collected_chunks.append(chunk)
                    yield chunk

                aggregated = _aggregate_model_chunks(collected_chunks)

                span.log(
                    output=aggregated,
                    metrics=extract_streaming_metrics(aggregated, start),
                )

        return _trace_astream()

    if hasattr(Model, "ainvoke_stream"):
        wrap_function_wrapper(Model, "ainvoke_stream", ainvoke_stream_wrapper)

    def response_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.response"

        input, clean_kwargs = get_args_kwargs(
            args, kwargs, ["messages", "response_format", "tools", "functions", "tool_chocie", "tool_call_limit"]
        )

        with start_span(
            name=span_name,
            # TODO: should be LLM?
            type=SpanTypeAttribute.LLM,
            input=input,
            metadata={**clean_kwargs, **extract_metadata(instance, "model")},
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=extract_metrics(result, kwargs.get("messages", [])),
            )
            return result

    if hasattr(Model, "response"):
        wrap_function_wrapper(Model, "response", response_wrapper)

    async def aresponse_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.aresponse"

        input, clean_kwargs = get_args_kwargs(
            args, kwargs, ["messages", "response_format", "tools", "functions", "tool_chocie", "tool_call_limit"]
        )

        with start_span(
            name=span_name,
            # TODO: should be LLM?
            type=SpanTypeAttribute.LLM,
            input=input,
            metadata={**clean_kwargs, **extract_metadata(instance, "model")},
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=extract_metrics(result, kwargs.get("messages", [])),
            )
            return result

    if hasattr(Model, "aresponse"):
        wrap_function_wrapper(Model, "aresponse", aresponse_wrapper)

    def response_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.response_stream"

        input, clean_kwargs = get_args_kwargs(
            args, kwargs, ["messages", "response_format", "tools", "functions", "tool_chocie", "tool_call_limit"]
        )

        def _trace_stream():
            start = time.time()
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.LLM,
                input=input,
                metadata={**clean_kwargs, **extract_metadata(instance, "model")},
            ) as span:
                first = True
                collected_chunks = []

                for chunk in wrapped(*args, **kwargs):
                    if first:
                        span.log(
                            metrics={
                                "time_to_first_token": time.time() - start,
                            }
                        )
                        first = False

                    collected_chunks.append(chunk)
                    yield chunk

                aggregated = _aggregate_response_stream_chunks(collected_chunks)

                span.log(
                    output=aggregated,
                    metrics=extract_streaming_metrics(aggregated, start),
                )

        return _trace_stream()

    if hasattr(Model, "response_stream"):
        wrap_function_wrapper(Model, "response_stream", response_stream_wrapper)

    def aresponse_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        model_name = _get_model_name(instance)
        span_name = f"{model_name}.aresponse_stream"

        input, clean_kwargs = get_args_kwargs(
            args, kwargs, ["messages", "response_format", "tools", "functions", "tool_chocie", "tool_call_limit"]
        )

        async def _trace_astream():
            start = time.time()
            with start_span(
                name=span_name,
                type=SpanTypeAttribute.LLM,
                input=input,
                metadata={**clean_kwargs, **extract_metadata(instance, "model")},
            ) as span:
                first = True
                collected_chunks = []

                async for chunk in wrapped(*args, **kwargs):
                    if first:
                        span.log(
                            metrics={
                                "time_to_first_token": time.time() - start,
                            }
                        )
                        first = False

                    collected_chunks.append(chunk)
                    yield chunk

                aggregated = _aggregate_response_stream_chunks(collected_chunks)

                span.log(
                    output=aggregated,
                    metrics=extract_streaming_metrics(aggregated, start),
                )

        return _trace_astream()

    if hasattr(Model, "aresponse_stream"):
        wrap_function_wrapper(Model, "aresponse_stream", aresponse_stream_wrapper)

    mark_patched(Model)
    return Model


def _get_model_name(instance: Any) -> str:
    if hasattr(instance, "get_provider") and callable(instance.get_provider):
        return str(instance.get_provider())
    return getattr(instance.__class__, "__name__", "Model")
