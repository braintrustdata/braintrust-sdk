import logging
import os
import warnings
from typing import Dict, Optional
from urllib.parse import urljoin

INSTALL_ERR_MSG = (
    "OpenTelemetry packages are not installed. "
    "Install optional OpenTelemetry dependencies with: pip install braintrust[otel]"
)

try:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    OTEL_AVAILABLE = True
except ImportError:
    # Don't warn in tests, it's annoying.
    if not os.environ.get("PYTEST_VERSION"):
        warnings.warn(
            INSTALL_ERR_MSG,
            UserWarning,
            stacklevel=2,
        )

    # Create stub classes if OpenTelemetry is not available
    class OTLPSpanExporter:
        def __init__(self, *args, **kwargs):
            raise ImportError(INSTALL_ERR_MSG)

    class BatchSpanProcessor:
        def __init__(self, *args, **kwargs):
            raise ImportError(INSTALL_ERR_MSG)

    class trace:
        @staticmethod
        def get_tracer_provider():
            raise ImportError(INSTALL_ERR_MSG)

    OTEL_AVAILABLE = False


FILTER_PREFIXES = ("gen_ai.", "braintrust.", "llm.", "ai.", "traceloop.")


class AISpanProcessor:
    """
    A span processor that filters spans to only export filtered telemetry.

    Only filtered spans and root spans will be forwarded to the inner processor.
    This dramatically reduces telemetry volume while preserving important observability.

    Example:
        > processor = AISpanProcessor(BatchSpanProcessor(OTLPSpanExporter()))
        > provider = TracerProvider()
        > provider.add_span_processor(processor)
    """

    def __init__(self, processor, custom_filter=None):
        """
        Initialize the filter span processor.

        Args:
            processor: The wrapped span processor that will receive filtered spans
                      (e.g., BatchSpanProcessor, SimpleSpanProcessor)
            custom_filter: Optional callable that takes a span and returns:
                          True to keep, False to drop,
                          None to not influence the decision
        """
        self._processor = processor
        self._custom_filter = custom_filter

    def on_start(self, span, parent_context=None):
        """Forward span start events to the inner processor."""
        self._processor.on_start(span, parent_context)

    def on_end(self, span):
        """Apply filtering logic and conditionally forward span end events."""
        if self._should_keep_filtered_span(span):
            self._processor.on_end(span)

    def shutdown(self):
        """Shutdown the inner processor."""
        self._processor.shutdown()

    def force_flush(self, timeout_millis=30000):
        """Force flush the inner processor."""
        return self._processor.force_flush(timeout_millis)

    def _should_keep_filtered_span(self, span):
        """
        Keep spans if:
        1. It's a root span (no parent)
        2. Custom filter returns True/False (if provided)
        3. Span name starts with 'gen_ai.', 'braintrust.', 'llm.', 'ai.', or 'traceloop.'
        4. Any attribute name starts with those prefixes
        """
        if not span:
            return False

        # Braintrust requires root spans, so always keep them
        if span.parent is None:
            return True

        # Apply custom filter if provided
        if self._custom_filter:
            custom_result = self._custom_filter(span)
            if custom_result is True:
                return True
            elif custom_result is False:
                return False
            # custom_result is None - continue with default logic

        if span.name.startswith(FILTER_PREFIXES):
            return True

        if span.attributes:
            for attr_name in span.attributes.keys():
                if attr_name.startswith(FILTER_PREFIXES):
                    return True

        return False


class OtelExporter(OTLPSpanExporter):
    """
    A subclass of OTLPSpanExporter configured for Braintrust.

    For most use cases, consider using the Processor class instead, which provides
    a more convenient all-in-one interface.

    Environment Variables:
    - BRAINTRUST_API_KEY: Your Braintrust API key.
    - BRAINTRUST_PARENT: Parent identifier (e.g., "project_name:test").
    - BRAINTRUST_API_URL: Base URL for Braintrust API (defaults to https://api.braintrust.dev).
    """

    def __init__(
        self,
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        parent: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
        **kwargs,
    ):
        """
        Initialize the OtelExporter.

        Args:
            url: OTLP endpoint URL. Defaults to {BRAINTRUST_API_URL}/otel/v1/traces.
            api_key: Braintrust API key. Defaults to BRAINTRUST_API_KEY env var.
            parent: Parent identifier (e.g., "project_name:test"). Defaults to BRAINTRUST_PARENT env var.
            headers: Additional headers to include in requests.
            **kwargs: Additional arguments passed to OTLPSpanExporter.
        """
        base_url = os.environ.get("BRAINTRUST_API_URL", "https://api.braintrust.dev")
        # Ensure base_url ends with / for proper joining
        if not base_url.endswith("/"):
            base_url += "/"
        endpoint = url or urljoin(base_url, "otel/v1/traces")
        api_key = api_key or os.environ.get("BRAINTRUST_API_KEY")
        parent = parent or os.environ.get("BRAINTRUST_PARENT")
        headers = headers or {}

        if not api_key:
            raise ValueError(
                "API key is required. Provide it via api_key parameter or BRAINTRUST_API_KEY environment variable."
            )

        # Default parent if not provided
        if not parent:
            parent = "project_name:default-otel-project"
            logging.info(
                f"No parent specified, using default: {parent}. "
                "Configure with BRAINTRUST_PARENT environment variable or parent parameter."
            )

        exporter_headers = {
            "Authorization": f"Bearer {api_key}",
            **headers,
        }

        if parent:
            exporter_headers["x-bt-parent"] = parent

        self.parent = parent

        super().__init__(endpoint=endpoint, headers=exporter_headers, **kwargs)


def add_braintrust_span_processor(tracer_provider,
    api_key: Optional[str] = None,
    parent: Optional[str] = None,
    api_url: Optional[str] = None,
    filter_ai_spans: bool = False,
    custom_filter=None,
    headers: Optional[Dict[str, str]] = None,
):
    processor = BraintrustSpanProcessor(
        api_key=api_key,
        parent=parent,
        api_url=api_url,
        filter_ai_spans=filter_ai_spans,
        custom_filter=custom_filter,
        headers=headers,
    )
    tracer_provider.add_span_processor(processor)


class BraintrustSpanProcessor:
    """
    A convenient all-in-one span processor for Braintrust OpenTelemetry integration.

    This class combines the OtelExporter, BatchSpanProcessor, and optionally AISpanProcessor
    into a single easy-to-use processor that can be directly added to a TracerProvider.

    Example:
        > processor = BraintrustSpanProcessor()
        > provider.add_span_processor(processor)

        > processor = BraintrustSpanProcessor(filter_ai_spans=True)
        > provider.add_span_processor(processor)
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        parent: Optional[str] = None,
        api_url: Optional[str] = None,
        filter_ai_spans: bool = False,
        custom_filter = None,
        headers: Optional[Dict[str, str]] = None,
        SpanProcessor: Optional[type] = None,
    ):
        """
        Initialize the BraintrustSpanProcessor.

        Args:
            api_key: Braintrust API key. Defaults to BRAINTRUST_API_KEY env var.
            parent: Parent identifier (e.g., "project_name:test"). Defaults to BRAINTRUST_PARENT env var.
            api_url: Base URL for Braintrust API. Defaults to BRAINTRUST_API_URL env var or https://api.braintrust.dev.
            filter_ai_spans: Whether to enable AI span filtering. Defaults to False.
            custom_filter: Optional custom filter function for filtering.
            headers: Additional headers to include in requests.
            SpanProcessor: Optional span processor class (BatchSpanProcessor or SimpleSpanProcessor). Defaults to BatchSpanProcessor.
        """
        # Create the exporter
        # Convert api_url to the full endpoint URL that OtelExporter expects
        exporter_url = None
        if api_url:
            exporter_url = f"{api_url.rstrip('/')}/otel/v1/traces"

        self._exporter = OtelExporter(url=exporter_url, api_key=api_key, parent=parent, headers=headers)

        # Create the processor chain
        if not OTEL_AVAILABLE:
            raise ImportError(
                "OpenTelemetry packages are not installed. "
                "Install optional OpenTelemetry dependencies with: pip install braintrust[otel]"
            )

        if SpanProcessor is None:
            SpanProcessor = BatchSpanProcessor

        # Always create a BatchSpanProcessor first
        processor = SpanProcessor(self._exporter)

        if filter_ai_spans:
            # Wrap the BatchSpanProcessor with filtering
            self._processor = AISpanProcessor(processor, custom_filter=custom_filter)
        else:
            # Use BatchSpanProcessor directly
            self._processor = processor

    def on_start(self, span, parent_context=None):
        try:
            parent_value = None

            # Priority 1: Check if braintrust.parent is in current OTEL context
            from opentelemetry import context
            current_context = context.get_current()
            parent_value = context.get_value('braintrust.parent', current_context)

            # Priority 2: Check if parent_context has braintrust.parent (backup)
            if not parent_value and parent_context:
                parent_value = context.get_value('braintrust.parent', parent_context)

            # Priority 3: Check if parent OTEL span has braintrust.parent attribute
            if not parent_value and parent_context:
                parent_value = self._get_parent_otel_braintrust_parent(parent_context)

            # Set the attribute if we found a parent value
            if parent_value:
                span.set_attribute("braintrust.parent", parent_value)

        except Exception as e:
            # If there's an exception, just don't set braintrust.parent
            pass

        self._processor.on_start(span, parent_context)


    def _get_parent_otel_braintrust_parent(self, parent_context):
        """Get braintrust.parent attribute from parent OTEL span if it exists."""
        try:
            from opentelemetry import trace

            # Get the current span from the parent context
            current_span = trace.get_current_span(parent_context)

            if current_span and hasattr(current_span, 'attributes') and current_span.attributes:
                # Check if parent span has braintrust.parent attribute
                attributes = dict(current_span.attributes)
                return attributes.get("braintrust.parent")

            return None

        except Exception:
            return None

    def on_end(self, span):
        """Forward span end events to the inner processor."""
        self._processor.on_end(span)

    def shutdown(self):
        """Shutdown the inner processor."""
        self._processor.shutdown()

    def force_flush(self, timeout_millis=30000):
        """Force flush the inner processor."""
        return self._processor.force_flush(timeout_millis)

    @property
    def exporter(self):
        """Access to the underlying OtelExporter."""
        return self._exporter

    @property
    def processor(self):
        """Access to the underlying span processor."""
        return self._processor
