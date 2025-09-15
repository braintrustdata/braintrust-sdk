"""OTEL context integration for Braintrust spans."""

import logging
from typing import Any, Optional

log = logging.getLogger(__name__)


def get_active_otel_span() -> Optional[Any]:
    """Get the currently active pure OTEL span if available."""
    try:
        from opentelemetry import trace

        current_span = trace.get_current_span()
        # Check if it's a real span (not NoOpSpan)
        if current_span and hasattr(current_span, 'get_span_context'):
            span_context = current_span.get_span_context()
            # Check if it's a valid span context (not invalid/unsampled)
            if span_context and span_context.span_id != 0:
                return current_span
        return None
    except ImportError:
        # OTEL not installed
        return None
    except Exception as e:
        log.debug(f"Failed to get active OTEL span: {e}")
        return None


def get_otel_span_info() -> Optional[dict]:
    """Get OTEL span information for Braintrust parent correlation."""
    otel_span = get_active_otel_span()
    if not otel_span:
        return None

    try:
        span_context = otel_span.get_span_context()
        return {
            'trace_id': format(span_context.trace_id, '032x'),
            'span_id': format(span_context.span_id, '016x'),
            'otel_span': otel_span
        }
    except Exception as e:
        log.debug(f"Failed to extract OTEL span info: {e}")
        return None


def should_use_otel_context() -> bool:
    """Check if OTEL context should be used for span parenting."""
    return get_active_otel_span() is not None


try:
    from opentelemetry.trace import Span as OtelSpan
    BaseSpan = OtelSpan
except ImportError:
    BaseSpan = object

class BraintrustOtelSpanWrapper(BaseSpan):
    """Wrapper that makes a Braintrust span look like an OTEL span for context purposes."""

    def __init__(self, bt_span):
        if hasattr(super(), '__init__'):
            super().__init__()
        self._bt_span = bt_span
        self._span_context = None

    def get_span_context(self):
        """Create OTEL span context from BT span."""
        if self._span_context is None:
            try:
                from opentelemetry.trace import SpanContext, TraceFlags
                from opentelemetry.trace.span import TraceState

                # Convert Braintrust UUID span IDs to OTEL integer format
                # The goal: make OTEL byteArrayToHex() output match BT's UUID format
                def uuid_to_int(uuid_string, bit_length):
                    """Convert UUID string to integer, preserving exact structure."""
                    # Remove dashes to get clean hex
                    hex_clean = uuid_string.replace('-', '')

                    if bit_length == 64:  # span_id - use last 64 bits of UUID
                        hex_clean = hex_clean[-16:]  # Last 16 hex chars (64 bits)
                    elif bit_length == 128:  # trace_id - use full UUID (128 bits)
                        hex_clean = hex_clean  # All 32 hex chars (128 bits)

                    return int(hex_clean, 16)

                # Convert BT span ID to OTEL span_id (64-bit)
                span_id_int = uuid_to_int(self._bt_span.span_id, 64)

                # Convert BT root_span_id to OTEL trace_id
                # When the server does byteArrayToHex(trace_id), it should produce
                # the same hex string as BT's UUID without dashes
                if hasattr(self._bt_span, 'root_span_id') and self._bt_span.root_span_id:
                    trace_id_int = uuid_to_int(self._bt_span.root_span_id, 128)
                else:
                    trace_id_int = uuid_to_int(self._bt_span.span_id, 128)

                self._span_context = SpanContext(
                    trace_id=trace_id_int,
                    span_id=span_id_int,
                    is_remote=False,
                    trace_flags=TraceFlags(TraceFlags.SAMPLED),
                    trace_state=TraceState()
                )
            except Exception as e:
                log.debug(f"Failed to create span context: {e}")
                return None

        return self._span_context

    def is_recording(self):
        """BT spans are always recording."""
        return True

    # Implement required OTEL Span abstract methods
    def add_event(self, name, attributes=None, timestamp=None):
        """Add event - forward to BT span if possible."""
        if hasattr(self._bt_span, 'log'):
            metadata = {'otel_event': name}
            if attributes:
                metadata.update(attributes)
            self._bt_span.log(metadata=metadata)

    def end(self, end_time=None):
        """End span - BT spans handle their own lifecycle."""
        pass

    def record_exception(self, exception, attributes=None, timestamp=None, escaped=False):
        """Record exception on BT span."""
        if hasattr(self._bt_span, 'log'):
            self._bt_span.log(error=str(exception))
            if attributes:
                self._bt_span.log(metadata=dict(attributes))

    def set_attribute(self, key, value):
        """Set attribute - forward to BT span metadata."""
        if hasattr(self._bt_span, 'log'):
            self._bt_span.log(metadata={key: value})

    def set_attributes(self, attributes):
        """Set multiple attributes."""
        if hasattr(self._bt_span, 'log') and attributes:
            self._bt_span.log(metadata=dict(attributes))

    def set_status(self, status, description=None):
        """Set status - map to BT span if error."""
        if hasattr(self._bt_span, 'log'):
            try:
                from opentelemetry.trace.status import StatusCode
                if status.status_code == StatusCode.ERROR:
                    self._bt_span.log(error=description or "OTEL span failed")
            except Exception:
                pass

    def update_name(self, name):
        """Update name - BT spans don't support name updates."""
        pass

    def __getattr__(self, name):
        """Forward unknown attributes to BT span or return no-op."""
        if hasattr(self._bt_span, name):
            return getattr(self._bt_span, name)
        # Return no-op function for OTEL-specific methods
        return lambda *args, **kwargs: None
