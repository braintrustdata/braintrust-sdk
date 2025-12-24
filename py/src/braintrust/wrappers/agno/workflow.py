import time
from typing import Any

from wrapt import wrap_function_wrapper

from braintrust.logger import start_span
from braintrust.span_types import SpanTypeAttribute

from .utils import (
    _aggregate_workflow_chunks,
    _try_to_dict,
    extract_metadata,
    extract_streaming_metrics,
    extract_workflow_metrics,
    is_patched,
    mark_patched,
    omit,
)


def wrap_workflow(Workflow: Any) -> Any:
    if is_patched(Workflow):
        return Workflow

    def run_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        workflow_name = getattr(instance, "name", None) or "Workflow"
        span_name = f"{workflow_name}.run"

        input_data = args[0] if args else kwargs.get("input")
        stream = kwargs.get("stream", False)

        if stream:
            return _trace_stream_sync(wrapped, instance, args, kwargs, workflow_name)

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input={"input": input_data},
            metadata={**omit(kwargs, ["input"]), **extract_metadata(instance, "workflow")},
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(
                output=_try_to_dict(result),
                metrics=extract_workflow_metrics(result),
            )
            return result

    wrap_function_wrapper(Workflow, "run", run_wrapper)

    def _trace_stream_sync(wrapped: Any, instance: Any, args: Any, kwargs: Any, workflow_name: str):
        span_name = f"{workflow_name}.run"
        input_data = args[0] if args else kwargs.get("input")

        def _trace_stream():
            start = time.time()
            span = start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input={"input": input_data},
                metadata={**omit(kwargs, ["input"]), **extract_metadata(instance, "workflow")},
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

                aggregated = _aggregate_workflow_chunks(all_chunks)

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

    async def arun_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        workflow_name = getattr(instance, "name", None) or "Workflow"
        span_name = f"{workflow_name}.arun"

        input_data = args[0] if args else kwargs.get("input")
        stream = kwargs.get("stream", False)

        if stream:
            return _trace_stream_async(wrapped, instance, args, kwargs, workflow_name)

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input={"input": input_data},
            metadata={**omit(kwargs, ["input"]), **extract_metadata(instance, "workflow")},
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(
                output=_try_to_dict(result),
                metrics=extract_workflow_metrics(result),
            )
            return result

    if hasattr(Workflow, "arun"):
        wrap_function_wrapper(Workflow, "arun", arun_wrapper)

    def _trace_stream_async(wrapped: Any, instance: Any, args: Any, kwargs: Any, workflow_name: str):
        span_name = f"{workflow_name}.arun"
        input_data = args[0] if args else kwargs.get("input")

        async def _trace_stream():
            start = time.time()
            span = start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input={"input": input_data},
                metadata={**omit(kwargs, ["input"]), **extract_metadata(instance, "workflow")},
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

                aggregated = _aggregate_workflow_chunks(all_chunks)

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

    mark_patched(Workflow)
    return Workflow
