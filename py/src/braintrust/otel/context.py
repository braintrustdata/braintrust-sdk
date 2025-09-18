"""Unified context management using OTEL's built-in context."""

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from braintrust.logger import Span

log = logging.getLogger(__name__)


@dataclass
class SpanInfo:
    """Information about a span in the context."""
    trace_id: str
    span_id: str
    span_object: Any = None
    metadata: Optional[Dict[str, Any]] = None


class ContextManager:
    """Context manager that uses OTEL's built-in context as single storage."""

    def __init__(self):
        pass

    def get_current_span_info(self) -> Optional['SpanInfo']:
        """Get information about the currently active span from OTEL context."""
        from opentelemetry import context, trace

        # Get the current span from OTEL context
        current_span = trace.get_current_span()

        if current_span and hasattr(current_span, 'get_span_context'):
            span_context = current_span.get_span_context()
            if span_context and span_context.span_id != 0:
                # Always prioritize the actual current OTEL span over stored BT span
                # Only use stored BT span if the current OTEL span IS the BT span wrapper
                bt_span = context.get_value('braintrust_span')

                # If there's a BT span stored AND the current OTEL span is a NonRecordingSpan
                # (which means it's our BT->OTEL wrapper), then return BT span info
                if (bt_span and hasattr(current_span, '__class__') and
                    'NonRecordingSpan' in str(current_span.__class__)):
                    return SpanInfo(
                        trace_id=bt_span.root_span_id,
                        span_id=bt_span.span_id,
                        span_object=bt_span
                    )
                else:
                    # Return OTEL span info - this is a real OTEL span, not our wrapper
                    otel_trace_id = format(span_context.trace_id, '032x')
                    otel_span_id = format(span_context.span_id, '016x')
                    return SpanInfo(
                        trace_id=otel_trace_id,
                        span_id=otel_span_id,
                        span_object=current_span
                    )

        return None

    def set_current_span(self, span_object: Span) -> None:
        """Set the current active span in OTEL context."""
        from opentelemetry import context, trace
        from opentelemetry.trace import SpanContext, TraceFlags

        if hasattr(span_object, 'get_span_context'):
            # This is an OTEL span - it will manage its own context
            pass
        else:

            # This is a BT span - store it in OTEL context AND set as current OTEL span
            # First store the BT span
            ctx = context.set_value('braintrust_span', span_object)
            parent_value = span_object._get_otel_parent()
            ctx = context.set_value('braintrust.parent', parent_value, ctx)

            # Create OTEL span context from BT span to set as current
            bt_trace_id_hex = span_object.root_span_id.replace('-', '')
            bt_span_id_hex = span_object.span_id.replace('-', '')[:16]  # Span ID should be 64-bit (16 hex chars)

            trace_id_int = int(bt_trace_id_hex, 16)
            span_id_int = int(bt_span_id_hex, 16)

            otel_span_context = SpanContext(
                trace_id=trace_id_int,
                span_id=span_id_int,
                is_remote=False,
                trace_flags=TraceFlags(TraceFlags.SAMPLED)
            )

            # Create a non-recording span to represent the BT span in OTEL context
            non_recording_span = trace.NonRecordingSpan(otel_span_context)

            # Set this as the current OTEL span
            ctx = context.set_value(trace._SPAN_KEY, non_recording_span, ctx)
            token = context.attach(ctx)
            # Store the token on the span for proper cleanup
            span_object._otel_context_token = token

    def unset_current_span(self, span_object: Any = None) -> None:
        """Unset the current active span from OTEL context."""
        from opentelemetry import context

        if span_object and hasattr(span_object, '_otel_context_token'):
            # Properly detach the context token stored on the span
            token = span_object._otel_context_token
            context.detach(token)
            # Clean up the token reference
            delattr(span_object, '_otel_context_token')

        # Clear BT span from context
        context.attach(context.set_value('braintrust_span', None))

    def get_parent_info_for_bt_span(self) -> Optional[Dict[str, Any]]:
        """Get parent information for creating a new BT span."""
        span_info = self.get_current_span_info()
        if not span_info:
            return None

        # Check if the current span is a BT span or OTEL span
        if hasattr(span_info.span_object, 'root_span_id'):
            # Current span is a BT span - use normal BT parenting
            bt_span = span_info.span_object
            return {
                'root_span_id': bt_span.root_span_id,
                'span_parents': [bt_span.span_id]
            }
        else:
            # Current span is an OTEL span - check if it's a real user span or fixture span
            span_name = getattr(span_info.span_object, 'name', 'unknown')

            # If this looks like a test fixture span, don't inherit from it
            if 'fixture' in span_name.lower() or span_name == 'unknown':
                return None

            # This is a real OTEL span - BT should inherit from it
            return {
                'root_span_id': span_info.trace_id,
                'span_parents': [span_info.span_id],
                'metadata': {
                    'otel_trace_id': span_info.trace_id,
                    'otel_span_id': span_info.span_id
                }
            }
