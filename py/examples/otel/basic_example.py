#!/usr/bin/env python3

import os
import time

os.environ.setdefault("BRAINTRUST_PARENT", "project_name:otel-examples")


from braintrust.otel import OtelExporter
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

# Set up the tracer provider
provider = TracerProvider()
trace.set_tracer_provider(provider)

# Create Braintrust exporter
exporter = OtelExporter(
    # api_key="your-api-key",  # Optional, will use BRAINTRUST_API_KEY env var
    # parent="project_name:test",  # Optional, will use BRAINTRUST_PARENT env var
    # url="https://api.braintrust.dev/otel/v1/traces",  # Optional, this is the default
)

# Add the exporter to the tracer provider
span_processor = BatchSpanProcessor(exporter)
provider.add_span_processor(span_processor)

# Create a tracer
tracer = trace.get_tracer(__name__)

# Create some spans
with tracer.start_as_current_span("parent_span") as parent_span:
    parent_span.set_attribute("operation", "example")

    with tracer.start_as_current_span("child_span") as child_span:
        child_span.set_attribute("step", "processing")
        time.sleep(0.1)

    with tracer.start_as_current_span("another_child_span") as child_span:
        child_span.set_attribute("step", "finalizing")
        time.sleep(0.05)

trace.get_tracer_provider().force_flush(30)
