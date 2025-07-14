#!/usr/bin/env python3

import os
import time

# Set environment variables
os.environ.setdefault("BRAINTRUST_PARENT", "project_name:otel-examples")
os.environ.setdefault("BRAINTRUST_OTEL_ENABLE_LLM_FILTER", "false")

from braintrust.otel import Processor
from openai import OpenAI
from opentelemetry import trace
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from opentelemetry.sdk.trace import TracerProvider

# Set up the tracer provider
provider = TracerProvider()
trace.set_tracer_provider(provider)

# Instrument OpenAI to automatically trace calls
OpenAIInstrumentor().instrument()

# Define a custom filter function
def my_custom_filter(span):
    """Keep spans that start with 'custom_' in addition to LLM spans."""
    if span.name.startswith("custom_"):
        return True
    return None  # Defer to default LLM filtering logic


# Create a single processor with all the available options
processor = Processor(
    api_url="https://api.braintrust.dev",  # Base URL for Braintrust API
    custom_filter=my_custom_filter,  # Custom filter function
)

# Add the processor to the tracer provider
provider.add_span_processor(processor)

# Create a tracer and generate some spans
tracer = trace.get_tracer(__name__)

print("Creating spans to demonstrate filtering behavior...")

# Create spans to test the filtering behavior
with tracer.start_as_current_span("custom.otel.example") as main_span:
    main_span.set_attribute("request_id", "12345")
    main_span.set_attribute("user_id", "demo-user")

    # Add a simple OpenAI call - this will be automatically traced by OpenTelemetry
    client = OpenAI()
    response = client.chat.completions.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": "Hello, world!"}], max_tokens=10
    )

    main_span.set_attribute("openai_response", response.choices[0].message.content)

    # This span will be kept (LLM-related)
    with tracer.start_as_current_span("microservice-call") as llm_span:
        llm_span.set_attribute("gen_ai.model", "gpt-4")
        llm_span.set_attribute("gen_ai.tokens", 150)
        time.sleep(0.1)

    # This span will be filtered out (not LLM-related)
    with tracer.start_as_current_span("database_query"):
        time.sleep(0.05)

# Force flush to ensure spans are sent
trace.get_tracer_provider().force_flush(30)
