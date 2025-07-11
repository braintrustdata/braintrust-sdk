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


class OtelExporter(OTLPSpanExporter):
    """
    A subclass of OTLPSpanExporter configured for Braintrust.
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

        # Add our exporter to the global tracer provider
        span_processor = BatchSpanProcessor(exporter)
        provider.add_span_processor(span_processor)
    except Exception as e:
        logging.warning(f"Failed to auto-configure Braintrust OpenTelemetry exporter: {e}")


# Auto-configure OpenTelemetry if BRAINTRUST_OTEL_ENABLE is set
if os.environ.get("BRAINTRUST_OTEL_ENABLE", "").lower() == "true":
    _auto_configure_braintrust_otel()
