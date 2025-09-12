#!/usr/bin/env python3
"""
Minimal OpenTelemetry + Braintrust integration example.
"""

import logging

log = logging.getLogger(__name__)
log.setLevel(logging.DEBUG)
log.addHandler(logging.StreamHandler())


import braintrust
from braintrust.otel import BraintrustSpanProcessor
from braintrust.otel.bridge import TracerProvider
from opentelemetry import trace

PROJECT_NAME = "otel-bt-eval"

# Setup OTEL
provider = TracerProvider()
trace.set_tracer_provider(provider)
parent = f"project_name:{PROJECT_NAME}"
span_processor = BraintrustSpanProcessor(parent=parent)
provider.add_span_processor(span_processor)




def task(question: str) -> str:
    """Task that demonstrates BT+OTEL integration."""

    # Get tracer - this will be our BT-integrated tracer
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("otel_task") as otel_span:
        # This is actually a BraintrustOtelSpan wrapping a BT span
        otel_span.set_attribute("otel.foo", "bar")

        # Add a Braintrust span
        with braintrust.current_span().start_span("bt_span") as bt_span:
            bt_span.log(metadata={"bt.key": "value"})

            # Add another Braintrust span that becomes active
            with braintrust.current_span().start_span("active_bt_span", set_current=True) as active_bt_span:
                active_bt_span.log(metadata={"active.key": "active_value"})

                # Add another OTEL span
                with tracer.start_as_current_span("nested_otel_task") as nested_span:
                    nested_span.set_attribute("nested.attr", "test")

    return "blah"


def scorer(output: str, expected: str) -> float:
    return 1.0 if expected in output else 0.0


def main():
    braintrust.init(project=PROJECT_NAME)

    result = braintrust.Eval(
        "minimal-eval",
        data=[{"input": {"question": "What is 2+2?"}, "expected": "4"}],
        task=lambda x: task(x["question"]),
        scores=[scorer],
    )

    print(f"Score: {result.summary.scores.get('scorer', 0)}")
    trace.get_tracer_provider().force_flush(30)


if __name__ == "__main__":
    main()
