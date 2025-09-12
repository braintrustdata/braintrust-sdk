
import braintrust
from braintrust.logger import current_span
from braintrust.test_helpers import assert_dict_matches, init_test_logger

# Conditional imports for OTEL - import at module level if available
try:
    from opentelemetry.trace.status import Status, StatusCode

    from braintrust.otel.bridge import TracerProvider as BTTracerProvider
except ImportError:
    # Will be caught by the fixture
    pass


def assert_has_parent(child, parent=None):
    """Assert that child span has parent as its direct parent."""
    if parent is None:
        assert child["span_parents"] is None
        assert child["root_span_id"] == child["span_id"]
    else:
        assert child["span_parents"] == [parent["span_id"]]
        assert child["root_span_id"] == parent["root_span_id"]



def test_experiment_with_bt_and_otel_tracing(with_memory_logger, if_otel_installed):
    """Test OTEL bridge with an experiment as parent context."""
    assert not with_memory_logger.pop()

    # Create a Braintrust experiment as the parent context
    experiment = braintrust.init(project="test_project", experiment="test_experiment")

    # Create OTEL tracer provider and tracer
    provider = BTTracerProvider()
    tracer = provider.get_tracer("experiment_test", "1.0.0")

    # Use experiment.start_span to create spans that will be logged to the experiment
    with experiment.start_span(name="s1") as exp_span:
        # Create OTEL spans within the experiment context
        with tracer.start_as_current_span("s2"):
            with current_span().start_span("s3"):
                with tracer.start_as_current_span("s4"):
                    pass
        with tracer.start_as_current_span("s5"):
            pass

    experiment.flush()

    # Check that events were logged
    spans = with_memory_logger.pop()
    assert len(spans) == 5

    # Verify experiment span
    spans_by_name = {s["span_attributes"]["name"]: s for s in spans}
    s1 = spans_by_name["s1"]
    s2 = spans_by_name["s2"]
    s3 = spans_by_name["s3"]
    s4 = spans_by_name["s4"]
    s5 = spans_by_name["s5"]
    assert_has_parent(s4, s3)
    assert_has_parent(s3, s2)
    assert_has_parent(s2, s1)
    assert_has_parent(s5, s1)
    assert_has_parent(s1, None)
   # All spans should have the same root
    for s in [s1, s2, s3, s4, s5]:
        assert s["root_span_id"] == s1["span_id"]


def test_verify_changing_parents(with_memory_logger, if_otel_installed):
    """Test parent relationships are established correctly."""
    init_test_logger(__name__)

    exp = braintrust.init(project="test", experiment="test")
    with exp.start_span("parent") as parent:
        parent.log(metadata={"a": 1})

        # Create child of parent by calling start_span on parent
        with parent.start_span("child") as child:
            child.log(metadata={"b": 2})

    spans = with_memory_logger.pop()
    spans_by_name = {s["span_attributes"]["name"]: s for s in spans}
    parent_span = spans_by_name["parent"]
    child_span = spans_by_name["child"]

    assert parent_span["metadata"]["a"] == 1
    assert child_span["metadata"]["b"] == 2

    # Verify parent-child relationship
    assert_has_parent(child_span, parent_span)

    # Parent should have no parents (it's root)
    assert not parent_span.get("span_parents") or parent_span["span_parents"] == []


def test_otel_kitchen_sink(with_memory_logger, if_otel_installed):
    """Test all OTEL features are properly copied to Braintrust spans."""
    init_test_logger(__name__)

    exp = braintrust.init(project="test", experiment="test")
    provider = BTTracerProvider()
    tracer = provider.get_tracer("kitchen_sink", "1.0.0")

    with exp.start_span("root") as root:
        with tracer.start_as_current_span("kitchen_sink") as otel_span:
            # Set multiple attributes
            otel_span.set_attribute("string_attr", "hello")
            otel_span.set_attribute("int_attr", 42)
            otel_span.set_attribute("float_attr", 3.14)
            otel_span.set_attribute("bool_attr", True)

            # Set multiple attributes at once
            otel_span.set_attributes({
                "batch_attr1": "value1",
                "batch_attr2": 123
            })

            # Add multiple events
            otel_span.add_event("start_event")
            otel_span.add_event("progress_event", {"progress": 50})
            otel_span.add_event("end_event", {"result": "success", "count": 10})

            # Set status codes
            otel_span.set_status(Status(StatusCode.OK, "All good"))

            # Record exception
            try:
                raise ValueError("Test exception")
            except Exception as e:
                otel_span.record_exception(e, {"exception_context": "test"})

    spans = with_memory_logger.pop()
    spans_by_name = {s["span_attributes"]["name"]: s for s in spans}

    root_span = spans_by_name["root"]
    kitchen_span = spans_by_name["kitchen_sink"]

    # Verify parent relationship
    assert_has_parent(kitchen_span, root_span)

    # Verify all data was copied correctly using assert_dict_matches
    assert_dict_matches(kitchen_span, {
        "metadata": {
            "string_attr": "hello",
            "int_attr": 42,
            "float_attr": 3.14,
            "bool_attr": True,
            "batch_attr1": "value1",
            "batch_attr2": 123,
            "otel.events": [
                {"name": "start_event"},
                {"name": "progress_event", "attributes": {"progress": 50}},
                {"name": "end_event", "attributes": {"result": "success", "count": 10}}
            ],
            "exception_context": "test"
        },
        "error": lambda e: "Test exception" in e,
        "created": lambda c: isinstance(c, str)
    })
