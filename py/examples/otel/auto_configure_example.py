#!/usr/bin/env python3

import os

# Set environment variables at the top before any imports
os.environ["BRAINTRUST_OTEL_ENABLE"] = "true"
os.environ.setdefault("BRAINTRUST_PARENT", "project_name:otel-examples")

import time

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

# set a tracer provider before importing braintrust.
trace.set_tracer_provider(TracerProvider())

import braintrust.otel

# Create a tracer
tracer = trace.get_tracer(__name__)

# Create some spans - these will automatically be exported to Braintrust if enabled
with tracer.start_as_current_span("auto_configure_example") as main_span:
    main_span.set_attribute("example_type", "auto_configure")
    main_span.set_attribute("language", "python")
    time.sleep(0.5)

# Force flush to ensure spans are sent
trace.get_tracer_provider().force_flush(30)
