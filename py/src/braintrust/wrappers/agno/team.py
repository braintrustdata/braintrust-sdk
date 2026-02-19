import time
from typing import Any

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute
from wrapt import wrap_function_wrapper

from .utils import (
    _aggregate_agent_chunks,
    extract_metadata,
    extract_metrics,
    extract_streaming_metrics,
    is_patched,
    mark_patched,
    omit,
)


def wrap_team(Team: Any) -> Any:
    if is_patched(Team):
        return Team

    def _create_run_span(wrapped: Any, instance: Any, args: Any, kwargs: Any, input_data: dict):
        """Shared logic to create span and execute run method."""
        agent_name = getattr(instance, "name", None) or "Team"
        span_name = f"{agent_name}.run"

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input=input_data,
            metadata={**omit(kwargs, list(input_data.keys())), **extract_metadata(instance, "team")},
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=extract_metrics(result),
            )
            return result

    def _run_wrapper_private(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        """Entry point for private _run(run_response, run_messages)."""
        run_response = args[0] if len(args) > 0 else kwargs.get("run_response")
        run_messages = args[1] if len(args) > 1 else kwargs.get("run_messages")
        input_data = {"run_response": run_response, "run_messages": run_messages}
        return _create_run_span(wrapped, instance, args, kwargs, input_data)

    def _run_wrapper_public(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        """Entry point for public run(input)."""
        input_arg = args[0] if len(args) > 0 else kwargs.get("input")
        input_data = {"input": input_arg}
        return _create_run_span(wrapped, instance, args, kwargs, input_data)

    # Wrap private method if it exists, otherwise wrap public method
    if hasattr(Team, "_run"):
        wrap_function_wrapper(Team, "_run", _run_wrapper_private)
    elif hasattr(Team, "run"):
        wrap_function_wrapper(Team, "run", _run_wrapper_public)

    async def _create_arun_span(wrapped: Any, instance: Any, args: Any, kwargs: Any, input_data: dict):
        """Shared logic to create span and execute arun method."""
        agent_name = getattr(instance, "name", None) or "Team"
        span_name = f"{agent_name}.arun"

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input=input_data,
            metadata={**omit(kwargs, list(input_data.keys())), **extract_metadata(instance, "team")},
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=extract_metrics(result),
            )
            return result

    async def _arun_wrapper_private(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        """Entry point for private _arun(run_response, input)."""
        run_response = args[0] if len(args) > 0 else kwargs.get("run_response")
        input_arg = args[1] if len(args) > 1 else kwargs.get("input")
        input_data = {"run_response": run_response, "input": input_arg}
        return await _create_arun_span(wrapped, instance, args, kwargs, input_data)

    async def _arun_wrapper_public(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        """Entry point for public arun(input)."""
        input_arg = args[0] if len(args) > 0 else kwargs.get("input")
        input_data = {"input": input_arg}
        return await _create_arun_span(wrapped, instance, args, kwargs, input_data)

    # Wrap private method if it exists, otherwise wrap public method
    if hasattr(Team, "_arun"):
        wrap_function_wrapper(Team, "_arun", _arun_wrapper_private)
    elif hasattr(Team, "arun"):
        wrap_function_wrapper(Team, "arun", _arun_wrapper_public)

    def run_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Team"
        span_name = f"{agent_name}.run_stream"

        run_response = args[0] if args else kwargs.get("run_response")
        run_messages = args[1] if args else kwargs.get("run_messages")

        def _trace_stream():
            start = time.time()
            span = start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input={"run_response": run_response, "run_messages": run_messages},
                metadata={**omit(kwargs, ["run_response", "run_messages"]), **extract_metadata(instance, "team")},
            )
            span.set_current()

            should_unset = True
            try:
                first = True
                all_chunks = []

                for chunk in wrapped(*args, **kwargs):
                    if first:
                        span.log(
                            metrics={
                                "time_to_first_token": time.time() - start,
                            }
                        )
                        first = False
                    all_chunks.append(chunk)
                    yield chunk

                aggregated = _aggregate_agent_chunks(all_chunks)

                span.log(
                    output=aggregated,
                    metrics=extract_streaming_metrics(aggregated, start),
                )
            except GeneratorExit:
                # Generator was closed early (e.g., break from for loop)
                # Don't call unset_current() as context may have changed
                should_unset = False
                raise
            except Exception as e:
                span.log(
                    error=str(e),
                )
                raise
            finally:
                if should_unset:
                    span.unset_current()
                span.end()

        return _trace_stream()

    if hasattr(Team, "_run_stream"):
        wrap_function_wrapper(Team, "_run_stream", run_stream_wrapper)

    def arun_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Team"
        span_name = f"{agent_name}.arun_stream"

        run_response = args[0] if args else kwargs.get("run_response")
        input = args[2] if args else kwargs.get("input")

        async def _trace_stream():
            start = time.time()
            span = start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input={"run_response": run_response, "input": input},
                metadata={**omit(kwargs, ["run_response", "input"]), **extract_metadata(instance, "team")},
            )
            span.set_current()

            should_unset = True
            try:
                first = True
                all_chunks = []

                async for chunk in wrapped(*args, **kwargs):
                    if first:
                        span.log(
                            metrics={
                                "time_to_first_token": time.time() - start,
                            }
                        )
                        first = False
                    all_chunks.append(chunk)
                    yield chunk

                aggregated = _aggregate_agent_chunks(all_chunks)

                span.log(
                    output=aggregated,
                    metrics=extract_streaming_metrics(aggregated, start),
                )
            except GeneratorExit:
                # Generator was closed early (e.g., break from async for loop)
                # Don't call unset_current() as context may have changed
                should_unset = False
                raise
            except Exception as e:
                span.log(
                    error=str(e),
                )
                raise
            finally:
                if should_unset:
                    span.unset_current()
                span.end()

        return _trace_stream()

    if hasattr(Team, "_arun_stream"):
        wrap_function_wrapper(Team, "_arun_stream", arun_stream_wrapper)

    mark_patched(Team)
    return Team
