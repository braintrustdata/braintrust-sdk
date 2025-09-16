#!/usr/bin/env python3
"""
Example: Braintrust + OTEL Context Integration

This example demonstrates how Braintrust spans automatically capture OTEL context
information when created within active OTEL spans, enabling correlation between
pure OTEL instrumentation and Braintrust observability.

Key concept: No bridge needed - just pure OTEL + pure Braintrust with automatic correlation.
"""

import braintrust

# Setup OTEL (pure, standard OTEL - no Braintrust bridge)
try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
except ImportError:
    print("OpenTelemetry not installed. Install with: pip install opentelemetry-api opentelemetry-sdk")
    exit(1)

def setup_otel():
    """Setup OTEL instrumentation with Braintrust processor to send OTEL spans to server."""
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

    provider = TracerProvider()

    # Add console exporter to verify span data
    console_exporter = ConsoleSpanExporter()
    console_processor = BatchSpanProcessor(console_exporter)
    provider.add_span_processor(console_processor)

    # Add Braintrust span processor to send OTEL spans to Braintrust
    from braintrust.otel import BraintrustSpanProcessor
    processor = BraintrustSpanProcessor(parent="project_name:otel-context-demo")
    provider.add_span_processor(processor)

    # Set as global tracer provider
    trace.set_tracer_provider(provider)

    return trace.get_tracer(__name__, "1.0.0")

def main():
    # Setup
    tracer = setup_otel()
    project = braintrust.init_logger(
        project="otel-context-demo"
    )

    print("🚀 Starting OTEL + Braintrust context correlation demo...")
    print()

    # Demo 1: BT project as root span with OTEL instrumentation inside
    print("=== Demo 1: BT project as root, OTEL spans inside ===")
    with project.start_span("1.bt.root") as session_span:
        session_span.log(input="BT root span", metadata={"type": "root"})
        print(f"BT span: {session_span.span_id}")

        # OTEL spans inside BT context for system tracing
        with tracer.start_as_current_span("1.1.otel") as otel_span:
            otel_span.set_attribute("type", "otel_inside_bt")
            otel_span.add_event("start")

            # BT span for AI evaluation (nested under session)
            with session_span.start_span("1.2.bt.child") as llm_span:
                llm_span.log(input="BT child", output="result", scores={"score": 0.95})

            otel_span.add_event("end")

        session_span.log(scores={"final": 0.92})

    print()

    # Demo 2: OTEL as root span with BT spans inside
    print("=== Demo 2: OTEL as root, BT spans inside ===")
    with tracer.start_as_current_span("2.otel.root") as otel_root:
        otel_trace_id = format(otel_root.get_span_context().trace_id, '032x')
        otel_root.set_attribute("type", "otel_root")
        otel_root.add_event("otel_root_start")
        print(f"OTEL trace ID: {otel_trace_id}")

        # BT spans inside OTEL context - should inherit OTEL trace ID
        with project.start_span("2.1.bt.child") as bt_span:
            bt_span.log(input="BT span inside OTEL", metadata={"type": "bt_inside_otel"})
            print(f"BT root_span_id: {bt_span.root_span_id}")
            print(f"Trace IDs match: {bt_span.root_span_id == otel_trace_id}")

            # Nested BT span should also inherit same trace ID
            with bt_span.start_span("2.2.bt.grandchild") as bt_grandchild:
                bt_grandchild.log(input="Nested BT span", output="unified trace", scores={"accuracy": 0.88})
                print(f"BT grandchild root_span_id: {bt_grandchild.root_span_id}")
                print(f"Grandchild trace matches: {bt_grandchild.root_span_id == otel_trace_id}")

        otel_root.add_event("otel_root_end")

    print()

    # Flush BT data first to create the parent traces
    project.flush()

    # Then flush OTEL spans so they can attach to existing parents
    if hasattr(trace.get_tracer_provider(), 'force_flush'):
        trace.get_tracer_provider().force_flush(timeout_millis=5000)


if __name__ == "__main__":
    main()
