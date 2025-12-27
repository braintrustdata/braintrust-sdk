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


def wrap_agent(Agent: Any) -> Any:
    if is_patched(Agent):
        return Agent

    def run_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Agent"
        span_name = f"{agent_name}.run"

        run_response = args[0] if args else kwargs.get("run_response")
        run_messages = args[1] if args else kwargs.get("run_messages")

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input={"run_response": run_response, "run_messages": run_messages},
            metadata={**omit(kwargs, ["run_response", "run_messages"]), **extract_metadata(instance, "agent")},
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=extract_metrics(result),
            )
            return result

    wrap_function_wrapper(Agent, "_run", run_wrapper)

    async def arun_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Agent"
        span_name = f"{agent_name}.arun"

        run_response = args[0] if args else kwargs.get("run_response")
        input = args[1] if args else kwargs.get("input")

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input={"run_response": run_response, "input": input},
            metadata={**omit(kwargs, ["run_response", "input"]), **extract_metadata(instance, "agent")},
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(
                output=result,
                metrics=extract_metrics(result),
            )
            return result

    if hasattr(Agent, "_arun"):
        wrap_function_wrapper(Agent, "_arun", arun_wrapper)

    def run_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Agent"
        span_name = f"{agent_name}.run_stream"

        run_response = args[0] if args else kwargs.get("run_response")
        run_messages = args[1] if args else kwargs.get("run_messages")

        def _trace_stream():
            start = time.time()
            span = start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input={"run_response": run_response, "run_messages": run_messages},
                metadata={**omit(kwargs, ["run_response", "run_messages"]), **extract_metadata(instance, "agent")},
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

    if hasattr(Agent, "_run_stream"):
        wrap_function_wrapper(Agent, "_run_stream", run_stream_wrapper)

    def arun_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        agent_name = getattr(instance, "name", None) or "Agent"
        span_name = f"{agent_name}.arun_stream"

        run_response = args[0] if args else kwargs.get("run_response")
        input = args[2] if args else kwargs.get("input")

        async def _trace_stream():
            start = time.time()
            span = start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input={"run_response": run_response, "input": input},
                metadata={**omit(kwargs, ["run_response", "input"]), **extract_metadata(instance, "agent")},
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

    if hasattr(Agent, "_arun_stream"):
        wrap_function_wrapper(Agent, "_arun_stream", arun_stream_wrapper)

    mark_patched(Agent)
    return Agent
