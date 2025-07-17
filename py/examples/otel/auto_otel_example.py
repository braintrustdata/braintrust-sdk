#!/usr/bin/env python3

import os

# Set environment variables at the top before any imports
os.environ["BRAINTRUST_OTEL_ENABLE"] = "true"
os.environ["BRAINTRUST_OTEL_FILTER_AI_SPANS"] = "false"
os.environ["BRAINTRUST_PARENT"] = "project_name:otel-examples"

import time

from openai import OpenAI
from opentelemetry import trace
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from opentelemetry.sdk.trace import TracerProvider

# set a tracer provider before importing braintrust.
trace.set_tracer_provider(TracerProvider())

# Instrument OpenAI to automatically trace calls
OpenAIInstrumentor().instrument()

import braintrust.otel

# Create a tracer
tracer = trace.get_tracer(__name__)

# Create some spans - these will automatically be exported to Braintrust if enabled
with tracer.start_as_current_span("auto.otel.example") as main_span:
    main_span.set_attribute("example_type", "auto_configure")
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
