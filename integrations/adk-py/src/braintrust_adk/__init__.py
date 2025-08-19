import logging
import os
from typing import Optional, cast

from opentelemetry.sdk.trace import SpanProcessor

logger = logging.getLogger(__name__)

__all__ = ["setup_braintrust"]


def setup_braintrust(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
    batch_export: bool = True,
) -> bool:
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.trace import ProxyTracerProvider

        provider = cast(TracerProvider, trace.get_tracer_provider())

        # the user doesn't have a tracer setup
        if isinstance(provider, ProxyTracerProvider):
            provider = TracerProvider()
            trace.set_tracer_provider(provider)

        api_key = api_key or os.environ.get("BRAINTRUST_API_KEY")
        if not api_key:
            return False

        from braintrust.otel import BraintrustSpanProcessor

        parent = None
        if project_id:
            parent = f"project_id:{project_id}"
        elif project_name:
            parent = f"project_name:{project_name}"

        parent = parent or os.environ.get("BRAINTRUST_PARENT") or "project_name:default-google-adk-py"

        processor = cast(
            SpanProcessor, BraintrustSpanProcessor(api_key=api_key, parent=parent, batch_export=batch_export)
        )
        provider.add_span_processor(processor)
        return True
    except Exception as e:
        print("Failed to setup Braintrust:", e)
        return False
