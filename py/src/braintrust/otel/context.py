"""Unified context management using OTEL's built-in context."""

import logging
from typing import Any, Optional

from braintrust.context import ParentSpanIds, SpanInfo
from braintrust.logger import Span
from opentelemetry import context, trace
from opentelemetry.trace import SpanContext, TraceFlags

log = logging.getLogger(__name__)


class ContextManager:
    """Context manager that uses OTEL's built-in context as single storage."""

    def __init__(self):
        pass

    def get_current_span_info(self) -> Optional["SpanInfo"]:
        """Get information about the currently active span from OTEL context."""

        # Get the current span from OTEL context
        current_span = trace.get_current_span()
        if not current_span:
            return None

        if not _is_otel_span(current_span):
            # FIXME[matt] This should never happen, but we'll handle it anyway
            return None

        span_context = current_span.get_span_context()
        if span_context and span_context.span_id != 0:
            # Always prioritize the actual current OTEL span over stored BT span
            # Only use stored BT span if the current OTEL span IS the BT span wrapper
            bt_span = context.get_value("braintrust_span")

            # If there's a BT span stored AND the current OTEL span is a NonRecordingSpan
            # (which means it's our BT->OTEL wrapper), then return BT span info
            if bt_span and isinstance(current_span, trace.NonRecordingSpan):
                return SpanInfo(trace_id=bt_span.root_span_id, span_id=bt_span.span_id, span_object=bt_span)
            else:
                # Return OTEL span info - this is a real OTEL span, not our wrapper
                otel_trace_id = format(span_context.trace_id, "032x")
                otel_span_id = format(span_context.span_id, "016x")
                return SpanInfo(trace_id=otel_trace_id, span_id=otel_span_id, span_object=current_span)

        return None

    def set_current_span(self, span: Span) -> Any:
        """Set the current active span in OTEL context."""
        from opentelemetry import context, trace

        if hasattr(span, "get_span_context"):
            # This is an OTEL span - it will manage its own context
            return None
        else:
            try:
                trace_id_int = int(span.root_span_id, 16)
            except ValueError:
                log.debug(f"Invalid root_span_id: {span.root_span_id}")
                return None

            try:
                span_id_int = int(span.span_id, 16)
            except ValueError:
                log.debug(f"Invalid span_id: {span.span_id}")
                return None

            # This is a BT span - store it in OTEL context AND set as current OTEL span
            # First store the BT span
            ctx = context.set_value("braintrust_span", span)
            parent_value = span._get_otel_parent()
            ctx = context.set_value("braintrust.parent", parent_value, ctx)

            otel_span_context = SpanContext(
                trace_id=trace_id_int, span_id=span_id_int, is_remote=False, trace_flags=TraceFlags(TraceFlags.SAMPLED)
            )

            # Create a non-recording span to represent the BT span in OTEL context
            non_recording_span = trace.NonRecordingSpan(otel_span_context)

            # Set this as the current OTEL span
            ctx = context.set_value(trace._SPAN_KEY, non_recording_span, ctx)
            token = context.attach(ctx)
            # Return the token for the caller to store
            return token

    def unset_current_span(self, context_token: Any = None) -> None:
        """Unset the current active span from OTEL context."""
        from opentelemetry import context

        if context_token:
            # Detaching the token restores the previous context
            context.detach(context_token)
        else:
            # No token means we need to explicitly clear the span
            # This shouldn't normally happen, but handle it gracefully
            context.attach(context.set_value("braintrust_span", None))

    def get_parent_span_ids(self) -> ParentSpanIds | None:
        """Get parent information for creating a new BT span."""
        span_info = self.get_current_span_info()
        if not span_info:
            return None
        return ParentSpanIds(
            root_span_id=span_info.trace_id,
            span_parents=[span_info.span_id],
        )


def _is_otel_span(span: Any) -> bool:
    """Check if the span object is an OTEL span."""
    return hasattr(span, "get_span_context")
