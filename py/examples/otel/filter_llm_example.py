#!/usr/bin/env python3

import os
import time

# Set environment variables at the top before any imports
os.environ["BRAINTRUST_OTEL_ENABLE"] = "true"
os.environ["BRAINTRUST_OTEL_FILTER_LLM_ENABLE"] = "true"
os.environ.setdefault("BRAINTRUST_PARENT", "project_name:otel-examples")

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

# Set a tracer provider before importing braintrust
trace.set_tracer_provider(TracerProvider())

import braintrust.otel

# Create a tracer
tracer = trace.get_tracer(__name__)

# Create spans - only LLM-related spans will be exported to Braintrust
with tracer.start_as_current_span("user_request") as main_span:
    main_span.set_attribute("request_id", "12345")
    main_span.set_attribute("user_id", "user123")

    # This span will be filtered out (not LLM-related)
    with tracer.start_as_current_span("database_query"):
        time.sleep(0.1)

    # This span will be kept (gen_ai prefix)
    with tracer.start_as_current_span("gen_ai.completion") as llm_span:
        llm_span.set_attribute("gen_ai.model", "gpt-4")
        llm_span.set_attribute("gen_ai.tokens", 150)
        time.sleep(0.2)

    # This span will be filtered out (not LLM-related)
    with tracer.start_as_current_span("cache_lookup"):
        time.sleep(0.05)

    # This span will be kept (has llm attribute)
    with tracer.start_as_current_span("response_formatting") as resp_span:
        resp_span.set_attribute("llm.tokens", 100)
        time.sleep(0.1)

    # This span will be filtered out (not LLM-related)
    with tracer.start_as_current_span("http_response"):
        time.sleep(0.05)

# Force flush to ensure spans are sent
trace.get_tracer_provider().force_flush(30)
