"""Braintrust + OpenTelemetry bridge integration."""

import logging
from typing import Any, Mapping, Optional, Sequence

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider as OtelTracerProvider
from opentelemetry.trace import Context as OtelContext
from opentelemetry.trace import Link as OtelLink
from opentelemetry.trace import Span as OtelSpan
from opentelemetry.trace import SpanKind as OtelSpanKind
from opentelemetry.trace import Tracer as OtelTracer
from opentelemetry.trace.status import Status, StatusCode
from opentelemetry.util.types import AttributeValue as OtelAttributeValue

from braintrust.logger import SpanImpl, current_span

log = logging.getLogger(__name__)


class BraintrustOtelSpan(OtelSpan):
    """OTEL Span wrapper around a Braintrust span."""

    def __init__(self, bt_span: SpanImpl):
        """Initialize with BT span as the source of truth."""
        self._bt_span = bt_span

    def __enter__(self):
        self._bt_span.__enter__()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return self._bt_span.__exit__(exc_type, exc_val, exc_tb)

    def set_attribute(self, key: str, value: Any) -> None:
        """Set attribute on BT span."""
        # Map OTEL attributes to BT span metadata
        self._bt_span.log(metadata={key: value})

    def set_attributes(self, attributes: Mapping[str, Any]) -> None:
        """Set multiple attributes."""
        if attributes:
            self._bt_span.log(metadata=dict(attributes))

    def add_event(self, name: str, attributes: Optional[Mapping[str, Any]] = None, timestamp: Optional[int] = None) -> None:
        """Add event to BT span."""
        event_data = {'event': name}
        if attributes:
            event_data.update(attributes)
        self._bt_span.log(**event_data)

    def set_status(self, status: Status, description: Optional[str] = None) -> None:
        """Map OTEL status to BT span."""
        # Map status to Braintrust - log as error if failed
        if status.status_code == StatusCode.ERROR:
            self._bt_span.log(error=description or "OTEL span failed")

    def update_name(self, name: str) -> None:
        """BT spans don't support name updates after creation."""
        pass

    def is_recording(self) -> bool:
        """BT spans are always recording."""
        return True

    def record_exception(self, exception, attributes=None, timestamp=None, escaped=False):
        """Record exception on BT span."""
        self._bt_span.log(error=str(exception))
        if attributes:
            self._bt_span.log(metadata=dict(attributes))

    def get_span_context(self):
        """Create OTEL span context from BT span."""
        from opentelemetry.trace import SpanContext, TraceFlags
        from opentelemetry.trace.span import TraceState

        # Use BT span ID as trace/span IDs (simplified)
        # In production, you'd want proper ID conversion
        span_id_int = hash(self._bt_span.id) & 0xFFFFFFFFFFFFFFFF
        trace_id_int = hash(f"trace_{self._bt_span.id}") & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF

        return SpanContext(
            trace_id=trace_id_int,
            span_id=span_id_int,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
            trace_state=TraceState()
        )

    def end(self, end_time=None):
        """End the BT span - this is called when OTEL span context exits."""
        # The BT span will be ended when its context manager exits
        # We don't need to do anything here as the BT span handles its own lifecycle
        pass

    # For any other OTEL span methods, provide minimal implementations
    def __getattr__(self, name):
        # Return a no-op function for unknown methods
        return lambda *args, **kwargs: None


class Tracer(OtelTracer):
    """Braintrust-integrated OpenTelemetry Tracer."""

    def __init__(self, instrumenting_module_name: str, instrumenting_library_version: Optional[str] = None):
        self._instrumenting_module_name = instrumenting_module_name
        self._instrumenting_library_version = instrumenting_library_version

    def start_span(
        self,
        name: str,
        context: Optional[OtelContext] = None,
        kind: OtelSpanKind = OtelSpanKind.INTERNAL,
        attributes: Optional[Mapping[str, OtelAttributeValue]] = None,
        links: Optional[Sequence[OtelLink]] = None,
        start_time: Optional[int] = None,
        record_exception: bool = True,
        set_status_on_exception: bool = True,
    ) -> BraintrustOtelSpan:
        """Start a BT span and wrap it as OTEL span."""
        log.debug(f"start_span: {name}")

        # Check for existing spans in context
        bt_active = None
        otel_active = None

        if context:
            # Extract any existing span from OTEL context
            otel_active = trace.get_current_span(context)

        # Get current BT span
        bt_current = current_span()

        # Determine parent span
        child_of = None
        if isinstance(otel_active, BraintrustOtelSpan):
            # OTEL span is actually a wrapped BT span - use it as parent
            child_of = otel_active._bt_span
        elif bt_current and hasattr(bt_current, 'start_span'):
            # Use current BT span as parent
            child_of = bt_current

        # Create BT span (single source of truth)
        if child_of and hasattr(child_of, 'start_span'):
            bt_span = child_of.start_span(
                name=name,
                span_attributes=dict(attributes) if attributes else None
            )
        else:
            # Start root span
            bt_span = current_span().start_span(
                name=name,
                span_attributes=dict(attributes) if attributes else None
            )

        # Return OTEL-wrapped BT span
        return BraintrustOtelSpan(bt_span)

    def start_as_current_span(
        self,
        name: str,
        context: Optional[OtelContext] = None,
        kind: OtelSpanKind = OtelSpanKind.INTERNAL,
        attributes: Optional[Mapping[str, OtelAttributeValue]] = None,
        links: Optional[Sequence[OtelLink]] = None,
        start_time: Optional[int] = None,
        record_exception: bool = True,
        set_status_on_exception: bool = True
    ):
        """Start span as current span."""
        log.debug(f"start_as_current_span: {name}")

        # Create the span
        span = self.start_span(
            name, context, kind, attributes, links,
            start_time, record_exception, set_status_on_exception
        )

        # Return the span itself as a context manager - it handles both BT and OTEL lifecycle
        return span


class TracerProvider(OtelTracerProvider):
    """Braintrust-integrated OpenTelemetry TracerProvider."""

    def __init__(self, **kwargs):
        """Initialize with proper OTEL setup but override tracer creation."""
        super().__init__(**kwargs)
        self._bt_integration_enabled = True
        self._bt_tracers = {}

    def get_tracer(
        self,
        instrumenting_module_name: str,
        instrumenting_library_version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[Mapping[str, Any]] = None
    ) -> Tracer:
        """Get a Braintrust-integrated tracer."""
        log.debug(f"get_tracer: {instrumenting_module_name}")

        # Create cache key
        key = (instrumenting_module_name, instrumenting_library_version, schema_url)

        if key not in self._bt_tracers:
            # Create BT-integrated tracer
            self._bt_tracers[key] = Tracer(
                instrumenting_module_name,
                instrumenting_library_version
            )

        return self._bt_tracers[key]
