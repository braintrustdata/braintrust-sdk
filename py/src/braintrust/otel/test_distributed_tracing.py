"""
Unit tests for distributed tracing between Braintrust and OpenTelemetry.

Tests simulated cross-service/cross-process scenarios where trace context
is exported from one service and imported in another service.
"""

import os

import pytest
from braintrust.logger import _internal_with_memory_background_logger
from braintrust.otel import BraintrustSpanProcessor, context_from_span_export
from braintrust.test_helpers import init_test_logger, preserve_env_vars

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


@dataclass
class OtelFixture:
    tracer: object
    exporter: InMemorySpanExporter
    memory_logger: object


@pytest.fixture
def otel_fixture():
    """OTEL fixture for distributed tracing tests with memory exporters."""
    if not OTEL_AVAILABLE:
        pytest.skip("OpenTelemetry not installed")

    with preserve_env_vars("BRAINTRUST_OTEL_COMPAT", "BRAINTRUST_API_KEY"):
        # Enable OTEL compatibility mode
        os.environ["BRAINTRUST_OTEL_COMPAT"] = "true"
        os.environ["BRAINTRUST_API_KEY"] = "test-api-key-for-fixture"

        # Set up memory logger for BT spans
        with _internal_with_memory_background_logger() as memory_logger:
            # Set up OTEL components
            parent = "project_name:distributed-tracing-test"
            exporter = InMemorySpanExporter()
            processor = SimpleSpanProcessor(exporter)

            # Wrap with BraintrustSpanProcessor to handle braintrust.parent
            btsp = BraintrustSpanProcessor(parent=parent)
            btsp._processor = processor

            tp = TracerProvider()
            tp.add_span_processor(btsp)
            tracer = tp.get_tracer("distributed-tracing-test")

            fixture = OtelFixture(exporter=exporter, tracer=tracer, memory_logger=memory_logger)
            yield fixture
            tp.shutdown()


def test_bt_to_otel_simple_distributed_trace(otel_fixture):
    """
    Test simple distributed trace: BT span in Service A, OTEL span in Service B.

    Simulates:
    - Service A: Creates BT span, exports context
    - Service B: Imports context, creates OTEL child span

    Verifies exported spans have:
    - Unified trace_id
    - Correct parent relationship
    - braintrust.parent attribute
    """
    project_name = "service-a-project"
    tracer = otel_fixture.tracer
    otel_exporter = otel_fixture.exporter
    memory_logger = otel_fixture.memory_logger

    logger = init_test_logger(project_name)

    # ===== Service A: Create BT span and export =====
    with logger.start_span(name="service_a_span") as service_a_span:
        # Export context for sending to Service B
        exported_context = service_a_span.export()

        service_a_trace_id = service_a_span.root_span_id
        service_a_span_id = service_a_span.span_id

    # ===== Service B: Import context and create OTEL child span =====
    # Simulate receiving exported_context over network (e.g., in HTTP header)
    from opentelemetry import context as otel_context

    ctx = context_from_span_export(exported_context)

    # Attach the context to make it current, then create the span
    token = otel_context.attach(ctx)
    try:
        with tracer.start_as_current_span("service_b_span") as service_b_span:
            service_b_span.set_attribute("service", "service_b")
    finally:
        otel_context.detach(token)

    # ===== Verify exported spans =====
    bt_spans = memory_logger.pop()
    assert len(bt_spans) == 1, "Should have 1 BT span from Service A"

    otel_spans = otel_exporter.get_finished_spans()
    assert len(otel_spans) == 1, "Should have 1 OTEL span from Service B"

    # Get the spans
    service_a_exported = bt_spans[0]
    service_b_exported = otel_spans[0]

    # Convert OTEL IDs to hex for comparison
    service_b_trace_id = format(service_b_exported.context.trace_id, "032x")
    service_b_parent_span_id = format(service_b_exported.parent.span_id, "016x") if service_b_exported.parent else None

    # Assert unified trace ID
    assert service_a_trace_id == service_b_trace_id, (
        f"Trace IDs should match: {service_a_trace_id} != {service_b_trace_id}"
    )

    # Assert Service B span has Service A span as parent
    assert service_b_parent_span_id == service_a_span_id, (
        f"Service B parent should be Service A span: {service_b_parent_span_id} != {service_a_span_id}"
    )

    # Assert braintrust.parent attribute is set on OTEL span
    assert "braintrust.parent" in service_b_exported.attributes, "OTEL span should have braintrust.parent attribute"
    assert service_b_exported.attributes["braintrust.parent"] == f"project_name:{project_name}", (
        f"braintrust.parent should be 'project_name:{project_name}'"
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
