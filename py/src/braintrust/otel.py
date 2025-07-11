import logging
import os
import warnings
from typing import Any, Dict, Optional

try:
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
except ImportError:
    warnings.warn(
        "OpenTelemetry packages are not installed. "
        "Install them with: pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http",
        UserWarning,
        stacklevel=2,
    )

    # Create a stub class if OpenTelemetry is not available
    class OTLPSpanExporter:
        def __init__(self, *args, **kwargs):
            raise ImportError(
                "OpenTelemetry packages are not installed. "
                "Install them with: pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http"
            )


LLM_PREFIXES = ("gen_ai.", "braintrust.", "llm.", "ai.")


class LLMSpanProcessor:
    """
    A span processor that filters spans to only export LLM-related telemetry.

    Only LLM-related spans and root spans will be forwarded to the inner processor.
    This dramatically reduces telemetry volume while preserving LLM observability.

    Example:
        > processor = LLMSpanProcessor(BatchSpanProcessor(OTLPSpanExporter()))
        > provider = TracerProvider()
        > provider.add_span_processor(processor)
    """

    def __init__(self, processor, custom_filter=None):
        """
        Initialize the LLM span processor.

        Args:
            processor: The wrapped span processor that will receive filtered spans
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
        if self._should_keep_llm_span(span):
            self._processor.on_end(span)

    def shutdown(self):
        """Shutdown the inner processor."""
        self._processor.shutdown()

    def force_flush(self, timeout_millis=30000):
        """Force flush the inner processor."""
        return self._processor.force_flush(timeout_millis)

    def _should_keep_llm_span(self, span):
        """
        Keep spans if:
        1. It's a root span (no parent)
        2. Custom filter returns True/False (if provided)
        3. Span name starts with 'gen_ai.', 'braintrust.', 'llm.', or 'ai.'
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

        if span.name.startswith(LLM_PREFIXES):
            return True

        if span.attributes:
            for attr_name in span.attributes.keys():
                if attr_name.startswith(LLM_PREFIXES):
                    return True

        return False


class OtelExporter(OTLPSpanExporter):
    """
    A subclass of OTLPSpanExporter configured for Braintrust.

    Environment Variables:
    - BRAINTRUST_OTEL_ENABLE: Set to "true" to automatically configure OpenTelemetry
      with this exporter at import time.
    - BRAINTRUST_OTEL_FILTER_LLM_ENABLE: Set to "true" to automatically wrap the
      exporter with LLMSpanProcessor for filtering only LLM-related spans.
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
        endpoint = url or f"{base_url.rstrip('/')}/otel/v1/traces"
        api_key = api_key or os.environ.get("BRAINTRUST_API_KEY")
        parent = parent or os.environ.get("BRAINTRUST_PARENT")
        headers = headers or {}

        if not api_key:
            raise ValueError(
                "API key is required. Provide it via api_key parameter or BRAINTRUST_API_KEY environment variable."
            )

        exporter_headers = {
            "Authorization": f"Bearer {api_key}",
            **headers,
        }

        if parent:
            exporter_headers["x-bt-parent"] = parent

        self.parent = parent

        super().__init__(endpoint=endpoint, headers=exporter_headers, **kwargs)


def _auto_configure_braintrust_otel():
    """Auto-configure OpenTelemetry with Braintrust exporter if BRAINTRUST_OTEL_ENABLE is set."""
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        logging.warning(
            "BRAINTRUST_OTEL_ENABLE is set but OpenTelemetry packages are not installed. "
            "Install them with: pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http"
        )
        return

    # Get the global tracer provider
    provider = trace.get_tracer_provider()

    # Check if the provider has the add_span_processor method
    if not hasattr(provider, "add_span_processor"):
        logging.warning(
            "BRAINTRUST_OTEL_ENABLE is set but no tracer provider is set up. "
            "Please set a TracerProvider first. "
            "See: https://opentelemetry.io/docs/instrumentation/python/getting-started/"
        )
        return

    try:
        # Create our exporter
        exporter = OtelExporter()

        # Create the base span processor
        span_processor = BatchSpanProcessor(exporter)

        # Check if LLM filtering is enabled
        filter_llm_enabled = os.environ.get("BRAINTRUST_OTEL_FILTER_LLM_ENABLE", "").lower() == "true"
        if filter_llm_enabled:
            # Wrap the processor with LLM filtering
            span_processor = LLMSpanProcessor(span_processor)

        # Add our processor to the global tracer provider
        provider.add_span_processor(span_processor)
    except Exception as e:
        logging.warning(f"Failed to auto-configure Braintrust OpenTelemetry exporter: {e}")


# Auto-configure OpenTelemetry if BRAINTRUST_OTEL_ENABLE is set
if os.environ.get("BRAINTRUST_OTEL_ENABLE", "").lower() == "true":
    _auto_configure_braintrust_otel()
