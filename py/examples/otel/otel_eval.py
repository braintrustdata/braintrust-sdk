#!/usr/bin/env python3
"""
Simple OTEL Evaluation Example

Shows how to add OTEL tracing to a Braintrust evaluation task.
"""

import os

# Enable OTEL compatibility
os.environ['BRAINTRUST_OTEL_COMPAT'] = 'true'

from autoevals import Levenshtein
from braintrust import Eval
from braintrust.otel import BraintrustSpanProcessor
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

# Setup OTEL tracing
provider = TracerProvider()
processor = BraintrustSpanProcessor(parent="project_name:otel-eval-example")
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

def task_with_otel_tracing(input):
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("otel.eval.task") as span:
        span.set_attribute("input", input)

        # Simple task logic
        result = "Hi " + input

        span.set_attribute("output", result)
        return result

# Run evaluation with OTEL tracing
Eval(
    "Say Hi Bot",
    data=lambda: [
        {
            "input": "Foo",
            "expected": "Hi Foo",
        },
        {
            "input": "Bar",
            "expected": "Hello Bar",
        },
    ],
    task=task_with_otel_tracing,  # Task function includes OTEL spans
    scores=[Levenshtein],
)
