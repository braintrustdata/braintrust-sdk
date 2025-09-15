"""Test prototype of using pure OTEL context for BT span correlation."""

import braintrust
from braintrust.test_helpers import init_test_logger

# Conditional imports for OTEL - import at module level if available
try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
except ImportError:
    pass


def test_bt_span_captures_otel_context(with_memory_logger, if_otel_installed):
    """Test that BT spans capture active OTEL context info."""

    # Set up pure OTEL tracer (no bridge)
    provider = TracerProvider()
    processor = SimpleSpanProcessor(ConsoleSpanExporter())
    provider.add_span_processor(processor)
    trace.set_tracer_provider(provider)
    tracer = trace.get_tracer(__name__)

    # Initialize BT
    init_test_logger(__name__)
    exp = braintrust.init(project="test", experiment="test")

    # Test: Create OTEL span, then BT span inside it
    with tracer.start_as_current_span("pure_otel_span") as otel_span:
        # Inside OTEL context, create BT span
        with exp.start_span("bt_span") as bt_span:
            bt_span.log(metadata={"test": "data"})

    # Check what BT captured
    spans = with_memory_logger.pop()
    assert len(spans) == 1

    bt_span_data = spans[0]
    print("\n=== BT Span Data ===")
    print(f"Span name: {bt_span_data.get('span_attributes', {}).get('name')}")

    # Check if OTEL trace info was captured
    metadata = bt_span_data.get('metadata', {})
    if 'otel_trace_id' in metadata:
        print(f"OTEL trace ID captured: {metadata['otel_trace_id']}")
        print(f"OTEL span ID captured: {metadata['otel_span_id']}")
        print("✅ OTEL context successfully captured!")
    else:
        print("❌ No OTEL context captured")
        print("Available keys:", list(bt_span_data.keys()))
        print("Metadata keys:", list(metadata.keys()))

    # The idea: BT spans now carry OTEL correlation info without using the bridge
    # This allows pure OTEL instrumentation to correlate with BT observability
