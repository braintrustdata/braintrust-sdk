import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

__all__ = ["setup_braintrust"]


def setup_braintrust(
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    project_name: Optional[str] = None,
) -> bool:
    try:
        from opentelemetry import trace

        provider = trace.get_tracer_provider()

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

        processor = BraintrustSpanProcessor(api_key=api_key, parent=parent)
        provider.add_span_processor(processor)  # type: ignore
        return True
    except Exception as e:
        print("Failed to setup Braintrust:", e)
        return False
