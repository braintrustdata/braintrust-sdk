#!/usr/bin/env python3

import time

from braintrust.otel import OtelExporter
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

# Set up the tracer provider
trace.set_tracer_provider(TracerProvider())

# Create Braintrust exporter
exporter = OtelExporter(
    # api_key="your-api-key",  # Optional, will use BRAINTRUST_API_KEY env var
    # parent="project_name:test",  # Optional, will use BRAINTRUST_PARENT env var
    # url="https://api.braintrust.dev/otel/v1/traces",  # Optional, this is the default
)

print(f"Parent: {exporter.parent}")
print(f"Headers: {exporter._headers}")

# Add console exporter to see what spans look like
console_exporter = ConsoleSpanExporter()
console_processor = BatchSpanProcessor(console_exporter)
trace.get_tracer_provider().add_span_processor(console_processor)

# Add the exporter to the tracer provider
span_processor = BatchSpanProcessor(exporter)
trace.get_tracer_provider().add_span_processor(span_processor)

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

print("Spans created and exported to Braintrust!")

# Force flush to ensure spans are sent
trace.get_tracer_provider().force_flush(30)
