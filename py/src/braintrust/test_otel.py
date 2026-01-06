# pylint: disable=not-context-manager
import sys

import pytest


def _check_otel_installed():
    """Check if OpenTelemetry SDK is fully installed."""
    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter  # noqa: F401
        from opentelemetry.sdk.trace import TracerProvider  # noqa: F401
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # noqa: F401

        return True
    except ImportError:
        return False


OTEL_INSTALLED = _check_otel_installed()


@pytest.fixture
def uninstall_braintrust_otel():
    sys.modules.pop("braintrust.otel", None)
    yield
    sys.modules.pop("braintrust.otel", None)


def test_otel_import_behavior():
    """Test that OtelExporter can be imported and behaves correctly based on OpenTelemetry availability."""
    from braintrust.otel import OtelExporter

    if _check_otel_installed():
        # Should be able to create an instance with proper params
        assert hasattr(OtelExporter, "__init__")
    else:
        # Import succeeds but instantiation should raise ImportError
        assert hasattr(OtelExporter, "__init__")


def test_otel_exporter_creation():
    """Test OtelExporter creation with and without full OpenTelemetry SDK."""
    from braintrust.otel import OtelExporter

    if _check_otel_installed():
        with pytest.MonkeyPatch.context() as m:
            # Clear any existing environment variables first
            m.delenv("BRAINTRUST_API_KEY", raising=False)
            m.delenv("BRAINTRUST_PARENT", raising=False)

            # Set test environment variables
            m.setenv("BRAINTRUST_API_KEY", "test-api-key")
            m.setenv("BRAINTRUST_PARENT", "project_name:test")

            exporter = OtelExporter()
            assert exporter.parent == "project_name:test"

        with pytest.MonkeyPatch.context() as m:
            m.delenv("BRAINTRUST_API_KEY", raising=False)
            m.delenv("BRAINTRUST_PARENT", raising=False)

            with pytest.raises(ValueError, match="API key is required"):
                OtelExporter()
    else:
        # When SDK is not fully installed, instantiation should raise ImportError
        with pytest.raises(ImportError, match="OpenTelemetry packages are not installed"):
            OtelExporter(api_key="fake-key")


def test_otel_exporter_with_explicit_params():
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    from braintrust.otel import OtelExporter

    exporter = OtelExporter(
        url="https://custom.example.com/otel/v1/traces",
        api_key="explicit-api-key",
        parent="project_name:explicit-test",
        headers={"custom-header": "custom-value"},
    )

    assert exporter.parent == "project_name:explicit-test"

    # Check endpoint and headers
    assert exporter._endpoint == "https://custom.example.com/otel/v1/traces"
    expected_headers = {
        "Authorization": "Bearer explicit-api-key",
        "x-bt-parent": "project_name:explicit-test",
        "custom-header": "custom-value",
    }
    assert exporter._headers == expected_headers


def test_otel_exporter_no_parent(caplog):
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    import logging

    from braintrust.otel import OtelExporter

    with pytest.MonkeyPatch.context() as m:
        m.setenv("BRAINTRUST_API_KEY", "test-api-key")
        m.delenv("BRAINTRUST_PARENT", raising=False)

        # Capture log messages
        with caplog.at_level(logging.INFO):
            exporter = OtelExporter()

        # Check that default parent is set
        assert exporter.parent == "project_name:default-otel-project"

        # Check that logging message is shown
        assert "No parent specified, using default: project_name:default-otel-project" in caplog.text
        assert "Configure with BRAINTRUST_PARENT environment variable or parent parameter" in caplog.text


def test_braintrust_api_url_env_var():
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    from braintrust.otel import OtelExporter

    # Test default URL
    with pytest.MonkeyPatch.context() as m:
        m.setenv("BRAINTRUST_API_KEY", "test-api-key")
        m.setenv("BRAINTRUST_PARENT", "project_name:test")

        exporter = OtelExporter()

        assert exporter._endpoint == "https://api.braintrust.dev/otel/v1/traces"
        expected_headers = {"Authorization": "Bearer test-api-key", "x-bt-parent": "project_name:test"}
        assert exporter._headers == expected_headers

    # Test custom API URL
    with pytest.MonkeyPatch.context() as m:
        m.setenv("BRAINTRUST_API_KEY", "custom-key")
        m.setenv("BRAINTRUST_API_URL", "https://custom.braintrust.dev")
        m.delenv("BRAINTRUST_PARENT", raising=False)

        exporter = OtelExporter()

        assert exporter._endpoint == "https://custom.braintrust.dev/otel/v1/traces"
        expected_headers = {"Authorization": "Bearer custom-key", "x-bt-parent": "project_name:default-otel-project"}
        assert exporter._headers == expected_headers

    # Test custom API URL with trailing slash
    with pytest.MonkeyPatch.context() as m:
        m.setenv("BRAINTRUST_API_KEY", "custom-key")
        m.setenv("BRAINTRUST_API_URL", "https://custom.example.com/")
        m.delenv("BRAINTRUST_PARENT", raising=False)

        exporter = OtelExporter()

        assert exporter._endpoint == "https://custom.example.com/otel/v1/traces"


def test_braintrust_otel_filter_ai_spans_environment_variable():
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    import os

    from braintrust.otel import AISpanProcessor

    # Test that the environment variable is properly read
    original_value = os.environ.get("BRAINTRUST_OTEL_FILTER_AI_SPANS")

    try:
        # Test true value
        os.environ["BRAINTRUST_OTEL_FILTER_AI_SPANS"] = "true"
        assert os.environ.get("BRAINTRUST_OTEL_FILTER_AI_SPANS", "").lower() == "true"

        # Test false value
        os.environ["BRAINTRUST_OTEL_FILTER_AI_SPANS"] = "false"
        assert os.environ.get("BRAINTRUST_OTEL_FILTER_AI_SPANS", "").lower() == "false"

        # Test empty value
        os.environ["BRAINTRUST_OTEL_FILTER_AI_SPANS"] = ""
        assert os.environ.get("BRAINTRUST_OTEL_FILTER_AI_SPANS", "").lower() == ""

        # Test FilterSpanProcessor can be instantiated
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        memory_exporter = InMemorySpanExporter()
        simple_processor = SimpleSpanProcessor(memory_exporter)
        filter_processor = AISpanProcessor(simple_processor)

        # Verify it has the expected attributes
        assert hasattr(filter_processor, "_processor")
        assert hasattr(filter_processor, "_custom_filter")
        assert hasattr(filter_processor, "_should_keep_filtered_span")
        assert callable(filter_processor._should_keep_filtered_span)

    finally:
        # Restore original value
        if original_value is not None:
            os.environ["BRAINTRUST_OTEL_FILTER_AI_SPANS"] = original_value
        else:
            os.environ.pop("BRAINTRUST_OTEL_FILTER_AI_SPANS", None)


def test_braintrust_span_processor_class():
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    from braintrust.otel import BraintrustSpanProcessor

    # Test basic processor without filtering
    with pytest.MonkeyPatch.context() as m:
        m.setenv("BRAINTRUST_API_KEY", "test-api-key")
        processor = BraintrustSpanProcessor()

        # Should have the span processor interface
        assert hasattr(processor, "on_start")
        assert hasattr(processor, "on_end")
        assert hasattr(processor, "shutdown")
        assert hasattr(processor, "force_flush")
        assert callable(processor.on_start)
        assert callable(processor.on_end)
        assert callable(processor.shutdown)
        assert callable(processor.force_flush)

        # Should have access to underlying components
        assert hasattr(processor, "exporter")
        assert hasattr(processor, "processor")

    # Test processor with LLM filtering
    with pytest.MonkeyPatch.context() as m:
        m.setenv("BRAINTRUST_API_KEY", "test-api-key")
        processor_with_filtering = BraintrustSpanProcessor(filter_ai_spans=True)

        # Should have the same interface
        assert hasattr(processor_with_filtering, "on_start")
        assert hasattr(processor_with_filtering, "on_end")
        assert hasattr(processor_with_filtering, "shutdown")
        assert hasattr(processor_with_filtering, "force_flush")

    # Test processor with custom parameters
    with pytest.MonkeyPatch.context() as m:
        m.setenv("BRAINTRUST_API_KEY", "test-api-key")

        def custom_filter(span):
            return span.name.startswith("test_")

        processor_custom = BraintrustSpanProcessor(
            api_key="explicit-key",
            parent="project:test",
            api_url="https://custom.example.com",
            filter_ai_spans=True,
            custom_filter=custom_filter,
            headers={"X-Test-Header": "test"},
        )

        # Should have the same interface
        assert hasattr(processor_custom, "on_start")
        assert hasattr(processor_custom, "on_end")
        assert hasattr(processor_custom, "shutdown")
        assert hasattr(processor_custom, "force_flush")

        # Check that the exporter was created with the right parameters
        exporter = processor_custom.exporter
        assert exporter.parent == "project:test"
        assert exporter._endpoint == "https://custom.example.com/otel/v1/traces"
        assert exporter._headers["Authorization"] == "Bearer explicit-key"


class TestSpanFiltering:
    def setup_method(self):
        try:
            from opentelemetry.sdk.trace import TracerProvider  # noqa: F401
        except ImportError:
            pytest.skip("OpenTelemetry SDK not fully installed, skipping AISpanProcessor tests")

        from braintrust.otel import AISpanProcessor
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        self.memory_exporter = InMemorySpanExporter()
        self.provider = TracerProvider()

        # Create processor with our filtering logic
        base_processor = SimpleSpanProcessor(self.memory_exporter)
        self.filtering_processor = AISpanProcessor(base_processor)

        self.provider.add_span_processor(self.filtering_processor)
        self.tracer = self.provider.get_tracer("test_tracer")

    def teardown_method(self):
        if OTEL_INSTALLED:
            self.provider.shutdown()
            self.memory_exporter.clear()

    def test_keeps_root_spans(self):
        with self.tracer.start_as_current_span("root_operation"):
            pass

        spans = self.memory_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].name == "root_operation"

    def test_keeps_gen_ai_spans(self):
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("gen_ai.completion"):
                pass
            with self.tracer.start_as_current_span("regular_operation"):
                pass

        spans = self.memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]

        assert "root" in span_names
        assert "gen_ai.completion" in span_names
        assert "regular_operation" not in span_names

    def test_keeps_braintrust_spans(self):
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("braintrust.eval"):
                pass
            with self.tracer.start_as_current_span("database_query"):
                pass

        spans = self.memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]

        assert "braintrust.eval" in span_names
        assert "database_query" not in span_names

    def test_keeps_llm_spans(self):
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("llm.generate"):
                pass

        spans = self.memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]
        assert "llm.generate" in span_names

    def test_keeps_ai_spans(self):
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("ai.model_call"):
                pass

        spans = self.memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]
        assert "ai.model_call" in span_names

    def test_keeps_traceloop_spans(self):
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("traceloop.agent"):
                pass
            with self.tracer.start_as_current_span("traceloop.workflow.step"):
                pass

        spans = self.memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]
        assert "traceloop.agent" in span_names
        assert "traceloop.workflow.step" in span_names

    def test_keeps_spans_with_llm_attributes(self):
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("some_operation") as span:
                span.set_attribute("gen_ai.model", "gpt-4")
                span.set_attribute("regular_data", "value")
            with self.tracer.start_as_current_span("another_operation") as span:
                span.set_attribute("llm.tokens", 100)
            with self.tracer.start_as_current_span("traceloop_operation") as span:
                span.set_attribute("traceloop.agent_id", "agent-123")
            with self.tracer.start_as_current_span("third_operation") as span:
                span.set_attribute("database.connection", "postgres")

        spans = self.memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]

        assert "root" in span_names
        assert "some_operation" in span_names  # has gen_ai.model attribute
        assert "another_operation" in span_names  # has llm.tokens attribute
        assert "traceloop_operation" in span_names  # has traceloop.agent_id attribute
        assert "third_operation" not in span_names  # no LLM attributes

    def test_drops_non_llm_spans(self):
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("database_query"):
                pass
            with self.tracer.start_as_current_span("http_request"):
                pass
            with self.tracer.start_as_current_span("file_operation"):
                pass

        spans = self.memory_exporter.get_finished_spans()

        # Only root should be kept
        assert len(spans) == 1
        assert spans[0].name == "root"

    def test_custom_filter_keeps_spans(self):
        def custom_filter(span):
            if span.name == "custom_keep":
                return True
            return None  # Don't influence decision

        # Create processor with custom filter
        from braintrust.otel import AISpanProcessor
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        memory_exporter = InMemorySpanExporter()
        processor = AISpanProcessor(SimpleSpanProcessor(memory_exporter), custom_filter=custom_filter)
        provider = TracerProvider()
        provider.add_span_processor(processor)
        tracer = provider.get_tracer(__name__)

        with tracer.start_as_current_span("root"):
            with tracer.start_as_current_span("custom_keep"):
                pass
            with tracer.start_as_current_span("regular_operation"):
                pass

        spans = memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]

        assert "root" in span_names
        assert "custom_keep" in span_names  # kept by custom filter
        assert "regular_operation" not in span_names  # dropped by default logic

    def test_custom_filter_drops_spans(self):
        def custom_filter(span):
            if span.name == "gen_ai.drop_this":
                return False
            return None  # Don't influence decision

        # Create processor with custom filter
        from braintrust.otel import AISpanProcessor
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        memory_exporter = InMemorySpanExporter()
        processor = AISpanProcessor(SimpleSpanProcessor(memory_exporter), custom_filter=custom_filter)
        provider = TracerProvider()
        provider.add_span_processor(processor)
        tracer = provider.get_tracer(__name__)

        with tracer.start_as_current_span("root"):
            with tracer.start_as_current_span("gen_ai.drop_this"):
                pass
            with tracer.start_as_current_span("gen_ai.keep_this"):
                pass

        spans = memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]

        assert "root" in span_names
        assert "gen_ai.drop_this" not in span_names  # dropped by custom filter
        assert "gen_ai.keep_this" in span_names  # kept by default LLM logic

    def test_custom_filter_none_uses_default_logic(self):
        def custom_filter(span):
            return None  # Always defer to default logic

        # Create processor with custom filter
        from braintrust.otel import AISpanProcessor
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        memory_exporter = InMemorySpanExporter()
        processor = AISpanProcessor(SimpleSpanProcessor(memory_exporter), custom_filter=custom_filter)
        provider = TracerProvider()
        provider.add_span_processor(processor)
        tracer = provider.get_tracer(__name__)

        with tracer.start_as_current_span("root"):
            with tracer.start_as_current_span("gen_ai.completion"):
                pass
            with tracer.start_as_current_span("regular_operation"):
                pass

        spans = memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]

        assert "root" in span_names
        assert "gen_ai.completion" in span_names  # kept by default LLM logic
        assert "regular_operation" not in span_names  # dropped by default logic

    def test_filtering_vs_unfiltered_comparison(self):
        # Set up two separate exporters and processors
        from braintrust.otel import AISpanProcessor
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        all_spans_exporter = InMemorySpanExporter()
        filtered_spans_exporter = InMemorySpanExporter()

        # Processor that captures everything
        all_processor = SimpleSpanProcessor(all_spans_exporter)

        # Processor that filters LLM spans
        filtered_processor = AISpanProcessor(SimpleSpanProcessor(filtered_spans_exporter))

        # Set up provider with both processors
        provider = TracerProvider()
        provider.add_span_processor(all_processor)
        provider.add_span_processor(filtered_processor)
        tracer = provider.get_tracer("comparison_test")

        # Create a mix of spans - some LLM-related, some not
        with tracer.start_as_current_span("user_request") as root:
            root.set_attribute("request.id", "123")

            with tracer.start_as_current_span("database_query"):
                pass

            with tracer.start_as_current_span("gen_ai.completion") as llm_span:
                llm_span.set_attribute("gen_ai.model", "gpt-4")

            with tracer.start_as_current_span("cache_lookup"):
                pass

            with tracer.start_as_current_span("response_formatting") as resp_span:
                resp_span.set_attribute("llm.tokens", 150)

            with tracer.start_as_current_span("http_response"):
                pass

        # Clean up
        provider.shutdown()

        # Verify all spans were captured by the unfiltered exporter
        all_spans = all_spans_exporter.get_finished_spans()
        all_span_names = [span.name for span in all_spans]

        assert len(all_spans) == 6
        assert "user_request" in all_span_names
        assert "database_query" in all_span_names
        assert "gen_ai.completion" in all_span_names
        assert "cache_lookup" in all_span_names
        assert "response_formatting" in all_span_names
        assert "http_response" in all_span_names

        # Verify only LLM spans were captured by the filtered exporter
        filtered_spans = filtered_spans_exporter.get_finished_spans()
        filtered_span_names = [span.name for span in filtered_spans]

        assert len(filtered_spans) == 3
        assert "user_request" in filtered_span_names  # root span
        assert "gen_ai.completion" in filtered_span_names  # LLM name
        assert "response_formatting" in filtered_span_names  # LLM attribute


def test_parent_from_headers_invalid_inputs():
    """Test parent_from_headers with various invalid inputs."""
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    from braintrust.otel import parent_from_headers

    # Test 1: Empty headers
    result = parent_from_headers({})
    assert result is None

    # Test 2: Invalid traceparent (malformed)
    result = parent_from_headers({"traceparent": "invalid"})
    assert result is None

    # Test 3: Valid traceparent but invalid braintrust.parent format
    result = parent_from_headers(
        {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "baggage": "braintrust.parent=invalid_format",
        }
    )
    assert result is None

    # Test 4: Empty project_id
    result = parent_from_headers(
        {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "baggage": "braintrust.parent=project_id:",
        }
    )
    assert result is None

    # Test 5: Empty project_name
    result = parent_from_headers(
        {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "baggage": "braintrust.parent=project_name:",
        }
    )
    assert result is None

    # Test 6: Empty experiment_id
    result = parent_from_headers(
        {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "baggage": "braintrust.parent=experiment_id:",
        }
    )
    assert result is None

    # Test 7: Invalid trace_id length (too short)
    result = parent_from_headers(
        {"traceparent": "00-4bf92f3577b34da6-00f067aa0ba902b7-01", "baggage": "braintrust.parent=project_name:test"}
    )
    assert result is None

    # Test 8: Invalid span_id length (too short)
    result = parent_from_headers(
        {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa-01",
            "baggage": "braintrust.parent=project_name:test",
        }
    )
    assert result is None


def test_parent_from_headers_valid_input():
    """Test parent_from_headers with valid inputs."""
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    from braintrust.otel import parent_from_headers

    # Test with valid project_name
    result = parent_from_headers(
        {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "baggage": "braintrust.parent=project_name:test-project",
        }
    )
    assert result is not None
    # Result is base64 encoded, so just check it's a non-empty string
    assert isinstance(result, str)
    assert len(result) > 0

    # Test with valid project_id
    result = parent_from_headers(
        {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "baggage": "braintrust.parent=project_id:abc123",
        }
    )
    assert result is not None
    assert isinstance(result, str)
    assert len(result) > 0

    # Test with valid experiment_id
    result = parent_from_headers(
        {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "baggage": "braintrust.parent=experiment_id:exp-456",
        }
    )
    assert result is not None
    assert isinstance(result, str)
    assert len(result) > 0


def test_add_parent_to_baggage():
    """Test add_parent_to_baggage function."""
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    from braintrust.otel import add_parent_to_baggage
    from opentelemetry import baggage, context

    # Test adding parent to baggage
    token = add_parent_to_baggage("project_name:test-project")
    assert token is not None

    # Verify it's in baggage
    parent_value = baggage.get_baggage("braintrust.parent")
    assert parent_value == "project_name:test-project"

    # Clean up
    context.detach(token)


def test_add_span_parent_to_baggage():
    """Test add_span_parent_to_baggage function."""
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    from braintrust.otel import add_span_parent_to_baggage
    from opentelemetry import baggage, context, trace
    from opentelemetry.sdk.trace import TracerProvider

    # Setup tracer
    provider = TracerProvider()
    trace.set_tracer_provider(provider)
    tracer = trace.get_tracer(__name__)

    # Test with span that has braintrust.parent attribute
    with tracer.start_as_current_span("test_span") as span:
        span.set_attribute("braintrust.parent", "project_name:test")

        token = add_span_parent_to_baggage(span)
        assert token is not None

        # Verify it's in baggage
        parent_value = baggage.get_baggage("braintrust.parent")
        assert parent_value == "project_name:test"

        context.detach(token)

    # Test with span that doesn't have braintrust.parent attribute (should return None and warn)
    with tracer.start_as_current_span("test_span_no_attr") as span:
        token = add_span_parent_to_baggage(span)
        assert token is None

    # Test with None span (should return None and warn)
    token = add_span_parent_to_baggage(None)
    assert token is None


def test_composite_propagator_supports_all_formats():
    """Test that a composite propagator with B3 + W3C supports all header formats.

    This verifies that users can configure a composite propagator that handles:
    - W3C traceparent/baggage headers (for parent_from_headers)
    - B3 headers (for B3-based distributed tracing)

    All formats should work together without breaking each other.
    """
    if not _check_otel_installed():
        pytest.skip("OpenTelemetry SDK not fully installed, skipping test")

    from braintrust.otel import parent_from_headers
    from opentelemetry import baggage, trace
    from opentelemetry.baggage.propagation import W3CBaggagePropagator
    from opentelemetry.propagate import extract, get_global_textmap, inject, set_global_textmap
    from opentelemetry.propagators.b3 import B3MultiFormat
    from opentelemetry.propagators.composite import CompositePropagator
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

    # Save original propagator
    original_propagator = get_global_textmap()

    try:
        # Set up TracerProvider
        provider = TracerProvider()
        trace.set_tracer_provider(provider)
        tracer = trace.get_tracer("test-tracer")

        # Configure composite propagator with all formats
        composite = CompositePropagator(
            [B3MultiFormat(), TraceContextTextMapPropagator(), W3CBaggagePropagator()]
        )
        set_global_textmap(composite)

        # Test 1: W3C headers work with parent_from_headers
        w3c_headers = {
            "traceparent": "00-dbd7eedb3331c8ab4614fe0e1806e56e-14ff6a4acf7beead-01",
            "baggage": "braintrust.parent=project_name%3Aw3c-test",
        }
        result = parent_from_headers(w3c_headers)
        assert result is not None, "W3C headers should work with composite propagator"

        # Test 2: B3 headers are extracted correctly by OTEL (lowercase keys)
        b3_headers = {
            "x-b3-traceid": "dbd7eedb3331c8ab4614fe0e1806e56e",
            "x-b3-spanid": "14ff6a4acf7beead",
            "x-b3-sampled": "1",
        }
        b3_ctx = extract(b3_headers)
        b3_span = trace.get_current_span(b3_ctx)
        b3_span_ctx = b3_span.get_span_context()
        assert b3_span_ctx.span_id != 0, "B3 headers should be extracted correctly"
        assert format(b3_span_ctx.span_id, "016x") == "14ff6a4acf7beead"

        # Test 3: W3C headers are extracted correctly by OTEL
        w3c_ctx = extract(w3c_headers)
        w3c_span = trace.get_current_span(w3c_ctx)
        w3c_span_ctx = w3c_span.get_span_context()
        assert w3c_span_ctx.span_id != 0, "W3C headers should be extracted correctly"
        # Verify baggage is also extracted
        bt_parent = baggage.get_baggage("braintrust.parent", context=w3c_ctx)
        assert bt_parent == "project_name:w3c-test", "W3C baggage should be extracted correctly"

        # Test 4: Inside an active span, parent_from_headers still works
        with tracer.start_as_current_span("POST /v1/chat/completions"):
            result_in_span = parent_from_headers(w3c_headers)
            assert result_in_span is not None, "parent_from_headers should work inside active span"

        # Test 5: inject() produces both W3C and B3 headers
        with tracer.start_as_current_span("test-span"):
            injected_headers = {}
            inject(injected_headers)
            # Should have W3C headers
            assert "traceparent" in injected_headers, "inject should produce W3C traceparent"
            # Should have B3 headers (B3MultiFormat uses lowercase)
            assert "x-b3-traceid" in injected_headers, "inject should produce B3 headers"

        provider.shutdown()

    finally:
        # Restore original propagator
        set_global_textmap(original_propagator)
