#!/usr/bin/env python3
"""
Example: Braintrust + OTEL Context Integration

This example demonstrates how Braintrust spans automatically capture OTEL context
information when created within active OTEL spans, enabling correlation between
pure OTEL instrumentation and Braintrust observability.

Key concept: No bridge needed - just pure OTEL + pure Braintrust with automatic correlation.
"""

import os

os.environ['BRAINTRUST_OTEL_COMPAT'] = 'true'

import braintrust
from braintrust.otel import add_braintrust_span_processor

PROJECT_NAME = "mixed-otel-braintrust-python-2"

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider


def setup_otel():
    """Setup OTEL instrumentation with Braintrust processor to send OTEL spans to server."""
    provider = TracerProvider()
    add_braintrust_span_processor(provider, parent=f"project_name:{PROJECT_NAME}")
    trace.set_tracer_provider(provider)

    return trace.get_tracer(__name__, "1.0.0")

def main():
    # Setup
    braintrust.login()

    tracer = setup_otel()
    project = braintrust.init_logger(
        project=PROJECT_NAME
    )

    # Demo 1: BT project as root span with OTEL instrumentation inside
    with project.start_span("trace1_root_bt") as session_span:
        session_span.log(input="BT root span", metadata={"type": "root"})
        print(f"BT span link: {session_span.link()}")

        # OTEL spans inside BT context for system tracing
        with tracer.start_as_current_span("trace1_child_otel") as otel_span:
            otel_span.set_attribute("type", "otel_inside_bt")
            otel_span.add_event("start")

            # Nested OTEL spans to test parent propagation
            with tracer.start_as_current_span("trace1_grandchild_otel") as nested_otel:
                nested_otel.set_attribute("type", "nested_otel")

            @braintrust.traced
            def trace1_grandchild_bt_traced():
                pass

            trace1_grandchild_bt_traced()

            otel_span.add_event("end")

        @braintrust.traced
        def trace1_child_bt_traced():
            pass

        trace1_child_bt_traced()


    # Demo 2: OTEL as root span with BT spans inside
    with tracer.start_as_current_span("trace2_root_otel") as otel_root:
        otel_trace_id = format(otel_root.get_span_context().trace_id, '032x')
        otel_root.set_attribute("type", "otel_root")
        otel_root.add_event("otel_root_start")

        # BT spans inside OTEL context - should inherit OTEL trace ID
        with project.start_span("trace2_child_bt") as bt_span:
            bt_span.log(input="BT span inside OTEL", metadata={"type": "bt_inside_otel"})
            print(f"BT span link: {bt_span.link()}")

            with tracer.start_as_current_span("trace2_grandchild_otel") as otel_grandchild:
                otel_grandchild.set_attribute("type", "otel_grandchild")
                otel_grandchild.add_event("otel_grandchild_start")

            @braintrust.traced
            def trace2_grandchild_bt1():
                pass
            trace2_grandchild_bt1()

            # Nested BT span should also inherit same trace ID
            with bt_span.start_span("trace2_grandchild_bt") as bt_grandchild:
                bt_grandchild.log(input="Nested BT span", output="unified trace", scores={"accuracy": 0.88})

        @braintrust.traced
        def trace2_child_bt_traced():
            pass
        trace2_child_bt_traced()

        otel_root.add_event("otel_root_end")

    # Flush BT data first to create the parent traces
    project.flush()

    # Then flush OTEL spans so they can attach to existing parents
    if hasattr(trace.get_tracer_provider(), 'force_flush'):
        trace.get_tracer_provider().force_flush(timeout_millis=5000)


if __name__ == "__main__":
    main()
