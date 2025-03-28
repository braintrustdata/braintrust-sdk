"""
Exports `BraintrustTracingProcessor`, a `tracing.TracingProcessor` that logs traces to Braintrust.
"""
import datetime
from typing import Any, Dict, Optional, Union

from agents import tracing

import braintrust


def _span_type(span: tracing.Span[Any]) -> braintrust.SpanTypeAttribute:
    if span.span_data.type in ["agent", "handoff", "custom"]:
        return braintrust.SpanTypeAttribute.TASK
    elif span.span_data.type in ["function", "guardrail"]:
        return braintrust.SpanTypeAttribute.TOOL
    elif span.span_data.type in ["generation", "response"]:
        return braintrust.SpanTypeAttribute.LLM
    else:
        return braintrust.SpanTypeAttribute.TASK


def _span_name(span: tracing.Span[Any]) -> str:
    # TODO(sachin): span name should also come from the span_data.
    if (
        isinstance(span.span_data, tracing.AgentSpanData)
        or isinstance(span.span_data, tracing.FunctionSpanData)
        or isinstance(span.span_data, tracing.GuardrailSpanData)
        or isinstance(span.span_data, tracing.CustomSpanData)
    ):
        return span.span_data.name
    elif isinstance(span.span_data, tracing.GenerationSpanData):
        return "Generation"
    elif isinstance(span.span_data, tracing.ResponseSpanData):
        return "Response"
    elif isinstance(span.span_data, tracing.HandoffSpanData):
        return "Handoff"
    else:
        return "Unknown"


def _timestamp_from_maybe_iso(timestamp: Optional[str]) -> Optional[float]:
    if timestamp is None:
        return None
    return datetime.datetime.fromisoformat(timestamp).timestamp()


def _maybe_timestamp_elapsed(end: Optional[str], start: Optional[str]) -> Optional[float]:
    if start is None or end is None:
        return None
    return (datetime.datetime.fromisoformat(end) - datetime.datetime.fromisoformat(start)).total_seconds()


class BraintrustTracingProcessor(tracing.TracingProcessor):
    """
    `BraintrustTracingProcessor` is a `tracing.TracingProcessor` that logs traces to Braintrust.

    Args:
        logger: A `braintrust.Span` or `braintrust.Experiment` or `braintrust.Logger` to use for logging.
            If `None`, the current span, experiment, or logger will be selected exactly as in `braintrust.start_span`.
    """

    def __init__(self, logger: Optional[Union[braintrust.Span, braintrust.Experiment, braintrust.Logger]] = None):
        self._logger = logger
        self._spans: Dict[str, braintrust.Span] = {}

    def on_trace_start(self, trace: tracing.Trace) -> None:
        if self._logger is not None:
            self._spans[trace.trace_id] = self._logger.start_span(
                span_attributes={"type": "task", "name": trace.name},
                span_id=trace.trace_id,
                root_span_id=trace.trace_id,
                # TODO(sachin): Add start time when SDK provides it.
                # start_time=_timestamp_from_maybe_iso(trace.started_at),
            )
        else:
            self._spans[trace.trace_id] = braintrust.start_span(
                id=trace.trace_id,
                span_attributes={"type": "task", "name": trace.name},
                # TODO(sachin): Add start time when SDK provides it.
                # start_time=_timestamp_from_maybe_iso(trace.started_at),
            )

    def on_trace_end(self, trace: tracing.Trace) -> None:
        span = self._spans.pop(trace.trace_id)
        span.end()
        # TODO(sachin): Add end time when SDK provides it.
        # span.end(_timestamp_from_maybe_iso(trace.ended_at))

    def _agent_log_data(self, span: tracing.Span[tracing.AgentSpanData]) -> Dict[str, Any]:
        return {
            "metadata": {
                "tools": span.span_data.tools,
                "handoffs": span.span_data.handoffs,
                "output_type": span.span_data.output_type,
            }
        }

    def _response_log_data(self, span: tracing.Span[tracing.ResponseSpanData]) -> Dict[str, Any]:
        data = {}
        if span.span_data.input is not None:
            data["input"] = span.span_data.input
        if span.span_data.response is not None:
            data["output"] = span.span_data.response.output
        if span.span_data.response is not None:
            data["metadata"] = span.span_data.response.metadata or {}
            data["metadata"].update(
                span.span_data.response.model_dump(exclude={"input", "output", "metadata", "usage"})
            )

        data["metrics"] = {}
        ttft = _maybe_timestamp_elapsed(span.ended_at, span.started_at)
        if ttft is not None:
            data["metrics"]["time_to_first_token"] = ttft
        if span.span_data.response is not None and span.span_data.response.usage is not None:
            data["metrics"]["tokens"] = span.span_data.response.usage.total_tokens
            data["metrics"]["prompt_tokens"] = span.span_data.response.usage.input_tokens
            data["metrics"]["completion_tokens"] = span.span_data.response.usage.output_tokens

        return data

    def _function_log_data(self, span: tracing.Span[tracing.FunctionSpanData]) -> Dict[str, Any]:
        return {
            "input": span.span_data.input,
            "output": span.span_data.output,
        }

    def _handoff_log_data(self, span: tracing.Span[tracing.HandoffSpanData]) -> Dict[str, Any]:
        return {
            "metadata": {
                "from_agent": span.span_data.from_agent,
                "to_agent": span.span_data.to_agent,
            }
        }

    def _guardrail_log_data(self, span: tracing.Span[tracing.GuardrailSpanData]) -> Dict[str, Any]:
        return {
            "metadata": {
                "triggered": span.span_data.triggered,
            }
        }

    def _generation_log_data(self, span: tracing.Span[tracing.GenerationSpanData]) -> Dict[str, Any]:
        metrics = {}
        ttft = _maybe_timestamp_elapsed(span.ended_at, span.started_at)

        if ttft is not None:
            metrics["time_to_first_token"] = ttft

        usage = span.span_data.usage or {}
        if "prompt_tokens" in usage:
            metrics["prompt_tokens"] = usage["prompt_tokens"]
        elif "input_tokens" in usage:
            metrics["prompt_tokens"] = usage["input_tokens"]

        if "completion_tokens" in usage:
            metrics["completion_tokens"] = usage["completion_tokens"]
        elif "output_tokens" in usage:
            metrics["completion_tokens"] = usage["output_tokens"]

        if "total_tokens" in usage:
            metrics["tokens"] = usage["total_tokens"]
        elif "input_tokens" in usage and "output_tokens" in usage:
            metrics["tokens"] = usage["input_tokens"] + usage["output_tokens"]

        return {
            "input": span.span_data.input,
            "output": span.span_data.output,
            "metadata": {
                "model": span.span_data.model,
                "model_config": span.span_data.model_config,
            },
            "metrics": metrics,
        }

    def _custom_log_data(self, span: tracing.Span[tracing.CustomSpanData]) -> Dict[str, Any]:
        return span.span_data.data

    def _log_data(self, span: tracing.Span[Any]) -> Dict[str, Any]:
        if isinstance(span.span_data, tracing.AgentSpanData):
            return self._agent_log_data(span)
        elif isinstance(span.span_data, tracing.ResponseSpanData):
            return self._response_log_data(span)
        elif isinstance(span.span_data, tracing.FunctionSpanData):
            return self._function_log_data(span)
        elif isinstance(span.span_data, tracing.HandoffSpanData):
            return self._handoff_log_data(span)
        elif isinstance(span.span_data, tracing.GuardrailSpanData):
            return self._guardrail_log_data(span)
        elif isinstance(span.span_data, tracing.GenerationSpanData):
            return self._generation_log_data(span)
        elif isinstance(span.span_data, tracing.CustomSpanData):
            return self._custom_log_data(span)
        else:
            return {}

    def on_span_start(self, span: tracing.Span[tracing.SpanData]) -> None:
        if span.parent_id is not None:
            parent = self._spans[span.parent_id]
        else:
            parent = self._spans[span.trace_id]
        self._spans[span.span_id] = parent.start_span(
            id=span.span_id,
            name=_span_name(span),
            type=_span_type(span),
            start_time=_timestamp_from_maybe_iso(span.started_at),
        )

    def on_span_end(self, span: tracing.Span[tracing.SpanData]) -> None:
        s = self._spans.pop(span.span_id)
        s.log(error=span.error, **self._log_data(span))
        s.end(_timestamp_from_maybe_iso(span.ended_at))

    def shutdown(self) -> None:
        if self._logger is not None:
            self._logger.flush()
        else:
            braintrust.flush()

    def force_flush(self) -> None:
        if self._logger is not None:
            self._logger.flush()
        else:
            braintrust.flush()
