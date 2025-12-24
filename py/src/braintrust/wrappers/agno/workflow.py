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
)


def _extract_workflow_input(args: Any, kwargs: Any) -> dict:
    """Extract the input from _execute parameters.

    _execute signature: (self, session, execution_input, workflow_run_response, run_context, ...)
    - args[0]: session (WorkflowSession)
    - args[1]: execution_input (WorkflowExecutionInput) - contains .input
    - args[2]: workflow_run_response (WorkflowRunOutput) - contains .input, accumulates results
    """
    execution_input = args[1] if len(args) > 1 else kwargs.get("execution_input")
    workflow_run_response = args[2] if len(args) > 2 else kwargs.get("workflow_run_response")

    result = {}

    # Get the user's raw input from execution_input
    if execution_input:
        if hasattr(execution_input, "input"):
            result["input"] = execution_input.input
        # Include other relevant fields from execution_input
        result["execution_input"] = _try_to_dict(execution_input)

    # Get the run_response structure similar to Team
    if workflow_run_response:
        result["run_response"] = _try_to_dict(workflow_run_response)

    return result


def wrap_workflow(Workflow: Any) -> Any:
    if is_patched(Workflow):
        return Workflow

    # DEBUG: Check what methods exist
    print(f"DEBUG wrap_workflow: _execute exists: {hasattr(Workflow, '_execute')}")
    print(f"DEBUG wrap_workflow: _execute_stream exists: {hasattr(Workflow, '_execute_stream')}")
    print(f"DEBUG wrap_workflow: _aexecute exists: {hasattr(Workflow, '_aexecute')}")
    print(f"DEBUG wrap_workflow: _aexecute_stream exists: {hasattr(Workflow, '_aexecute_stream')}")

    def execute_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        """Wrapper for _execute (sync, non-streaming)."""
        print(f"DEBUG execute_wrapper CALLED! args count: {len(args)}")
        workflow_name = getattr(instance, "name", None) or "Workflow"
        span_name = f"{workflow_name}.run"

        input_data = _extract_workflow_input(args, kwargs)
        print(f"DEBUG execute_wrapper input_data: {input_data}")

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input=input_data,
            metadata=extract_metadata(instance, "workflow"),
        ) as span:
            result = wrapped(*args, **kwargs)
            span.log(
                output=_try_to_dict(result),
                metrics=extract_workflow_metrics(result),
            )
            return result

    if hasattr(Workflow, "_execute"):
        wrap_function_wrapper(Workflow, "_execute", execute_wrapper)

    def execute_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        """Wrapper for _execute_stream (sync, streaming)."""
        workflow_name = getattr(instance, "name", None) or "Workflow"
        span_name = f"{workflow_name}.run_stream"

        input_data = _extract_workflow_input(args, kwargs)

        def _trace_stream():
            start = time.time()
            span = start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input=input_data,
                metadata=extract_metadata(instance, "workflow"),
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

    if hasattr(Workflow, "_execute_stream"):
        wrap_function_wrapper(Workflow, "_execute_stream", execute_stream_wrapper)

    async def aexecute_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        """Wrapper for _aexecute (async, non-streaming)."""
        workflow_name = getattr(instance, "name", None) or "Workflow"
        span_name = f"{workflow_name}.arun"

        input_data = _extract_workflow_input(args, kwargs)

        with start_span(
            name=span_name,
            type=SpanTypeAttribute.TASK,
            input=input_data,
            metadata=extract_metadata(instance, "workflow"),
        ) as span:
            result = await wrapped(*args, **kwargs)
            span.log(
                output=_try_to_dict(result),
                metrics=extract_workflow_metrics(result),
            )
            return result

    if hasattr(Workflow, "_aexecute"):
        wrap_function_wrapper(Workflow, "_aexecute", aexecute_wrapper)

    def aexecute_stream_wrapper(wrapped: Any, instance: Any, args: Any, kwargs: Any):
        """Wrapper for _aexecute_stream (async, streaming)."""
        workflow_name = getattr(instance, "name", None) or "Workflow"
        span_name = f"{workflow_name}.arun_stream"

        input_data = _extract_workflow_input(args, kwargs)

        async def _trace_stream():
            start = time.time()
            span = start_span(
                name=span_name,
                type=SpanTypeAttribute.TASK,
                input=input_data,
                metadata=extract_metadata(instance, "workflow"),
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

    if hasattr(Workflow, "_aexecute_stream"):
        wrap_function_wrapper(Workflow, "_aexecute_stream", aexecute_stream_wrapper)

    mark_patched(Workflow)
    return Workflow
