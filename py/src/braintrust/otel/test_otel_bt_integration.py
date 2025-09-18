"""
Unit tests for OTEL + Braintrust context integration using memory exporters.

Tests that OTEL and Braintrust spans are properly grouped in unified traces
when created in mixed contexts.
"""


import pytest

from braintrust import current_span
from braintrust.otel import BraintrustSpanProcessor
from braintrust.test_helpers import init_test_exp, init_test_logger, memory_logger

OTEL_AVAILABLE = True
try:
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
except ImportError:
    class InMemorySpanExporter:
        def __init__(self):
            pass

        def get_finished_spans(self):
            return []

        def clear(self):
            pass

    OTEL_AVAILABLE = False

from dataclasses import dataclass

# FIXME[matt] pyright keeps deleting memory_logger because it doesn't
# know how to handle pytest fixtures.
_ = memory_logger

@dataclass
class OtelFixture:
    tracer: object
    exporter: InMemorySpanExporter


@pytest.fixture
def otel_fixture():
    if not OTEL_AVAILABLE:
        pytest.skip("OpenTelemetry not installed")

    parent = "project_name:otel-fixture-test"
    exporter = InMemorySpanExporter()
    processor = SimpleSpanProcessor(exporter)

    # FIXME[matt]: this is a hack to get the test to pass. Refactor BraintrustSpanProcessor to use
    # an instance of the processor instead of the exporter
    btsp = BraintrustSpanProcessor(parent=parent)
    btsp._processor = processor

    tp = TracerProvider()
    tp.add_span_processor(btsp)
    tracer = tp.get_tracer("otel-fixture-test")
    yield OtelFixture(exporter=exporter, tracer=tracer)


def test_mixed_otel_bt_tracing_with_bt_logger_first(memory_logger, otel_fixture):
    project_name = "mixed-tracing-with-bt-logger-first"
    tracer = otel_fixture.tracer
    otel_mem_exporter = otel_fixture.exporter

    logger = init_test_logger(project_name)

    with logger.start_span(name="1") as span1:
        assert current_span() == span1
        with tracer.start_as_current_span("2"):
            with logger.start_span(name="3") as span3:
                assert current_span() == span3
                pass

    bt_spans = memory_logger.pop()
    assert len(bt_spans) == 2
    bt_spans_by_name = {span["span_attributes"]["name"]: span for span in bt_spans}

    otel_spans = otel_mem_exporter.get_finished_spans()
    assert len(otel_spans) == 1
    otel_spans_by_name = {span.name: span for span in otel_spans}
    for span in otel_spans:
        assert span.attributes["braintrust.parent"] == f"project_name:{project_name}"

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


def test_mixed_otel_bt_tracing_with_experiment_parent(memory_logger, otel_fixture):
    experiment = init_test_exp("otel-bt-mixed", "test-mixed-tracing-experiment")
    tracer = otel_fixture.tracer
    otel_memory_exporter = otel_fixture.exporter

    with experiment.start_span(name="1") as span1:
        assert current_span() == span1
        with tracer.start_as_current_span("2"):
            with experiment.start_span(name="3") as span3:
                assert current_span() == span3

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


def test_mixed_otel_bt_tracing_with_otel_first(memory_logger, otel_fixture):
    logger = init_test_logger(__name__)
    tracer = otel_fixture.tracer
    otel_memory_exporter = otel_fixture.exporter

    with tracer.start_as_current_span("1"):
        with logger.start_span(name="2") as span2:
            assert current_span() == span2
            with tracer.start_as_current_span("3"):
                pass

    bt_spans = memory_logger.pop()
    assert len(bt_spans) == 1

    otel_spans = otel_memory_exporter.get_finished_spans()
    assert len(otel_spans) == 2

    # Create one dict of spans by name
    spans_by_name = {}
    for span in bt_spans:
        spans_by_name[span["span_attributes"]["name"]] = span
    for span in otel_spans:
        spans_by_name[span.name] = span

    assert len(spans_by_name) == 3

    s1, s2, s3 = spans_by_name["1"], spans_by_name["2"], spans_by_name["3"]

    # Verify unified trace IDs - convert OTEL traces to hex string for comparison
    s1_trace_id = format(s1.context.trace_id, '032x')
    s1_span_id = format(s1.context.span_id, '016x')
    s3_trace_id = format(s3.context.trace_id, '032x')
    s3_span_id = format(s3.context.span_id, '016x')

    assert s1_trace_id == s2["root_span_id"]
    assert s1_trace_id == s3_trace_id
    assert s2["root_span_id"] == s3_trace_id

    # Verify parent relationships - BT span should have OTEL span as parent
    assert s2["span_parents"] == [s1_span_id]
    assert s1_span_id in s2["span_parents"]


def test_separate_traces_should_not_be_unified(memory_logger, otel_fixture):
    """Test that separate, non-nested traces should remain separate (this should currently FAIL)."""
    logger = init_test_logger(__name__)
    tracer = otel_fixture.tracer

    # First trace: BT only
    trace1_spans = []
    with logger.start_span(name="bt_trace1") as bt_span1:
        trace1_spans.append(bt_span1.root_span_id)
        bt_span1.log(input="First trace")

    # Second trace: OTEL only
    trace2_spans = []
    with tracer.start_as_current_span("otel_trace2") as otel_span2:
        trace2_id = format(otel_span2.context.trace_id, '032x')
        trace2_spans.append(trace2_id)
        otel_span2.set_attribute("test", "second_trace")

    # Third trace: OTEL root with BT child
    trace3_spans = []
    with tracer.start_as_current_span("otel_trace3_root") as otel_span3:
        otel3_trace_id = format(otel_span3.context.trace_id, '032x')
        trace3_spans.append(otel3_trace_id)

        # BT span inside OTEL - should inherit OTEL trace ID, not previous BT trace
        with logger.start_span(name="bt_inside_otel3") as bt_span3:
            trace3_spans.append(bt_span3.root_span_id)

    # Verify we have 3 separate traces
    assert len(set(trace1_spans + trace2_spans + trace3_spans)) == 3

    # Specifically check that trace3 BT span uses OTEL trace ID, not trace1 BT trace ID
    assert trace3_spans[0] == trace3_spans[1], "BT span should inherit OTEL trace ID"
    assert trace1_spans[0] != trace3_spans[1], "BT span in trace3 should NOT reuse trace1's ID"


def test_otel_spans_inherit_parent_attribute(memory_logger, otel_fixture):
    """Test that OTEL spans created inside BT contexts get braintrust.parent attribute."""
    test_cases = [
        ("exp-666", "experiment_id:exp-666", lambda parent_name: init_test_exp(parent_name, "test-project")),
        ("name-777", "project_name:name-777", lambda parent_name: init_test_logger(parent_name)),
    ]

    tracer = otel_fixture.tracer
    otel_memory_exporter = otel_fixture.exporter

    for parent_name, expected_parent, parent_factory in test_cases:
        parent = parent_factory(parent_name)
        otel_memory_exporter.clear()

        with parent.start_span(name=f"bt_{parent_name}_span"):
            with tracer.start_as_current_span("otel_child"):
                with tracer.start_as_current_span("otel_child2"):
                    pass

        otel_spans = otel_memory_exporter.get_finished_spans()
        assert len(otel_spans) == 2

        for span in otel_spans:
            attrs = dict(span.attributes or {})
            assert "braintrust.parent" in attrs
            assert attrs["braintrust.parent"] == expected_parent

        bt_spans = memory_logger.pop()
        assert len(bt_spans) == 1



if __name__ == "__main__":
    pytest.main([__file__, "-v"])
