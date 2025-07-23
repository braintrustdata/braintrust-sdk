#!/usr/bin/env python3
"""
Basic OpenTelemetry example with Braintrust integration.

This example shows how to manually configure OpenTelemetry with BraintrustSpanProcessor
without any filtering enabled. All spans will be sent to Braintrust.
"""

import os
import time

# Set environment variables
os.environ.setdefault("BRAINTRUST_PARENT", "project_name:otel-examples")

from braintrust.otel import BraintrustSpanProcessor
from openai import OpenAI
from opentelemetry import trace
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from opentelemetry.sdk.trace import TracerProvider

# Set up the tracer provider
provider = TracerProvider()
trace.set_tracer_provider(provider)

# Instrument OpenAI to automatically trace calls
OpenAIInstrumentor().instrument()

# Create and add the Braintrust span processor
processor = BraintrustSpanProcessor(
    # No filtering enabled by default
    filter_ai_spans=False
)

# Add the processor to the tracer provider
provider.add_span_processor(processor)

# Create a tracer
tracer = trace.get_tracer(__name__)

print("Creating spans to demonstrate basic OpenTelemetry configuration...")

# Create some spans
with tracer.start_as_current_span("basic.otel.example") as main_span:
    main_span.set_attribute("example_type", "basic_configure")
    main_span.set_attribute("language", "python")

    # Add a simple OpenAI call - this will be automatically traced by OpenTelemetry
    client = OpenAI()
    response = client.chat.completions.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": "Hello, world!"}], max_tokens=10
    )

    main_span.set_attribute("openai_response", response.choices[0].message.content)
    time.sleep(0.5)

# Force flush to ensure spans are sent
trace.get_tracer_provider().force_flush(30)
