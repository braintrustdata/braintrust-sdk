"""
Unit tests for OTEL + Braintrust context integration using memory exporters.

Tests that OTEL and Braintrust spans are properly grouped in unified traces
when created in mixed contexts.
"""


import pytest

from braintrust import current_span
from braintrust.test_helpers import init_test_exp, init_test_logger

OTEL_AVAILABLE = True
try:
    import opentelemetry.trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

except ImportError:
    OTEL_AVAILABLE = False


@pytest.fixture
def otel_memory_exporter():
    """Set up OTEL with in-memory exporter."""
    if not OTEL_AVAILABLE:
        pytest.skip("OpenTelemetry not installed")

    original = opentelemetry.trace.get_tracer_provider()

    tp = TracerProvider()
    exporter = InMemorySpanExporter()
    processor = SimpleSpanProcessor(exporter)
    tp.add_span_processor(processor)
    opentelemetry.trace.set_tracer_provider(tp)
    try:
        yield exporter
    finally:
        opentelemetry.trace.set_tracer_provider(original)


def test_mixed_otel_bt_tracing_with_bt_logger_first(memory_logger, otel_memory_exporter):
    logger = init_test_logger(__name__)
    tracer = opentelemetry.trace.get_tracer(__name__)

    with logger.start_span(name="1") as span1:
        assert current_span() == span1
        with tracer.start_as_current_span("2"):
            with logger.start_span(name="3") as span3:
                assert current_span() == span3
                pass

    bt_spans = memory_logger.pop()
    assert len(bt_spans) == 2
    bt_spans_by_name = {span["span_attributes"]["name"]: span for span in bt_spans}

    otel_spans = otel_memory_exporter.get_finished_spans()
    assert len(otel_spans) == 1
    otel_spans_by_name = {span.name: span for span in otel_spans}

    # All spans accounted for
    assert len(bt_spans_by_name) + len(otel_spans_by_name) == 3

    s1, s3 = bt_spans_by_name["1"], bt_spans_by_name["3"]
    s2 = otel_spans_by_name["2"]

    # Verify unified trace IDs - convert OTEL trace to hex string for comparison
    s2_trace_id = format(s2.context.trace_id, '032x')
    s2_span_id = format(s2.context.span_id, '016x')

    assert s1["root_span_id"] == s2_trace_id
    assert s1["root_span_id"] == s3["root_span_id"]
    assert s2_trace_id == s3["root_span_id"]

    # Verify parent relationships
    assert s3["span_parents"] == [s2_span_id]
    assert s2_span_id in s3["span_parents"]


def test_mixed_otel_bt_tracing_with_experiment_parent(memory_logger, otel_memory_exporter):
    experiment = init_test_exp("otel-bt-mixed", "test-mixed-tracing")
    tracer = opentelemetry.trace.get_tracer(__name__)

    with experiment.start_span(name="1") as span1:
        assert current_span() == span1
        with tracer.start_as_current_span("2"):
            with experiment.start_span(name="3") as span3:
                assert current_span() == span3
                pass

    bt_spans = memory_logger.pop()
    assert len(bt_spans) == 2

    otel_spans = otel_memory_exporter.get_finished_spans()
    assert len(otel_spans) == 1

    # Create one dict of spans by name
    spans_by_name = {}
    for span in bt_spans:
        spans_by_name[span["span_attributes"]["name"]] = span
    for span in otel_spans:
        spans_by_name[span.name] = span

    assert len(spans_by_name) == 3

    s1, s2, s3 = spans_by_name["1"], spans_by_name["2"], spans_by_name["3"]

    # Verify unified trace IDs - convert OTEL trace to hex string for comparison
    s2_trace_id = format(s2.context.trace_id, '032x')
    s2_span_id = format(s2.context.span_id, '016x')

    assert s1["root_span_id"] == s2_trace_id
    assert s1["root_span_id"] == s3["root_span_id"]
    assert s2_trace_id == s3["root_span_id"]

    # Verify parent relationships
    assert s3["span_parents"] == [s2_span_id]
    assert s2_span_id in s3["span_parents"]




if __name__ == "__main__":
    pytest.main([__file__, "-v"])
