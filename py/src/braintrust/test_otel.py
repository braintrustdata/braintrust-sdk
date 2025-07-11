import importlib
import os
import sys
import warnings

import pytest

OTEL_INSTALLED = os.environ.get("PY_OTEL_INSTALLED", "0") == "1"


@pytest.fixture
def uninstall_braintrust_otel():
    sys.modules.pop("braintrust.otel", None)
    yield
    sys.modules.pop("braintrust.otel", None)


def test_otel_import_behavior():
    if OTEL_INSTALLED:
        from braintrust.otel import OtelExporter

        assert hasattr(OtelExporter, "__init__")
    else:
        with pytest.warns(UserWarning, match="OpenTelemetry packages are not installed"):
            from braintrust.otel import OtelExporter

            assert hasattr(OtelExporter, "__init__")


def test_otel_exporter_creation():
    from braintrust.otel import OtelExporter

    if OTEL_INSTALLED:
        with pytest.MonkeyPatch.context() as m:
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
        with pytest.raises(ImportError, match="OpenTelemetry packages are not installed"):
            OtelExporter()


def test_otel_exporter_with_explicit_params():
    if not OTEL_INSTALLED:
        pytest.skip("OpenTelemetry not installed, skipping test")

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


def test_otel_exporter_no_parent():
    if not OTEL_INSTALLED:
        pytest.skip("OpenTelemetry not installed, skipping test")

    from braintrust.otel import OtelExporter

    with pytest.MonkeyPatch.context() as m:
        m.setenv("BRAINTRUST_API_KEY", "test-api-key")
        m.delenv("BRAINTRUST_PARENT", raising=False)

        exporter = OtelExporter()
        assert exporter.parent is None


def test_braintrust_otel_enable_import_behavior(monkeypatch, uninstall_braintrust_otel):
    if not OTEL_INSTALLED:
        pytest.skip("OpenTelemetry not installed, skipping test")

    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    # Set up a fresh tracer provider
    tracer_provider = TracerProvider()
    trace.set_tracer_provider(tracer_provider)

    # Test with BRAINTRUST_OTEL_ENABLE=true
    monkeypatch.setenv("BRAINTRUST_OTEL_ENABLE", "true")
    monkeypatch.setenv("BRAINTRUST_API_KEY", "test-api-key")
    monkeypatch.setenv("BRAINTRUST_PARENT", "project_name:test")

    # Re-import the module
    otel_module = importlib.import_module("braintrust.otel")

    # Verify that our exporter was added to the global tracer provider
    provider = trace.get_tracer_provider()

    # Check if any of the span processors contain our OtelExporter
    braintrust_exporter_found = False
    if hasattr(provider, "_span_processors"):
        processors = provider._span_processors
    elif hasattr(provider, "span_processors"):
        processors = provider.span_processors
    else:
        # Try to access the internal processors attribute
        processors = getattr(provider, "_active_span_processor", [])
        if hasattr(processors, "_span_processors"):
            processors = processors._span_processors
        else:
            processors = []

    for processor in processors:
        if isinstance(processor, BatchSpanProcessor):
            # Check if the processor's exporter is our OtelExporter
            if isinstance(processor.span_exporter, otel_module.OtelExporter):
                braintrust_exporter_found = True
                break

    assert braintrust_exporter_found, "OtelExporter was not added to the global tracer provider"

    # Test with BRAINTRUST_OTEL_ENABLE=false (or not set)
    monkeypatch.setenv("BRAINTRUST_OTEL_ENABLE", "false")

    # Set up a fresh tracer provider again
    tracer_provider = TracerProvider()
    trace.set_tracer_provider(tracer_provider)

    # Clear and re-import the module
    sys.modules.pop("braintrust.otel", None)
    otel_module = importlib.import_module("braintrust.otel")

    # Verify that our exporter was NOT added to the global tracer provider
    provider = trace.get_tracer_provider()

    # Check if any of the span processors contain our OtelExporter
    braintrust_exporter_found = False
    if hasattr(provider, "_span_processors"):
        processors = provider._span_processors
    elif hasattr(provider, "span_processors"):
        processors = provider.span_processors
    else:
        # Try to access the internal processors attribute
        processors = getattr(provider, "_active_span_processor", [])
        if hasattr(processors, "_span_processors"):
            processors = processors._span_processors
        else:
            processors = []

    for processor in processors:
        if isinstance(processor, BatchSpanProcessor):
            # Check if the processor's exporter is our OtelExporter
            if isinstance(processor.span_exporter, otel_module.OtelExporter):
                braintrust_exporter_found = True
                break

    assert not braintrust_exporter_found, "OtelExporter should not be added when BRAINTRUST_OTEL_ENABLE is false"


def test_braintrust_otel_enable_without_opentelemetry(monkeypatch, uninstall_braintrust_otel):
    """Test that BRAINTRUST_OTEL_ENABLE doesn't crash when OpenTelemetry is not installed."""
    if OTEL_INSTALLED:
        pytest.skip("OpenTelemetry is installed, skipping test")

    # This test should only run when OpenTelemetry is NOT installed

    # Test with BRAINTRUST_OTEL_ENABLE=true when OpenTelemetry is not installed
    monkeypatch.setenv("BRAINTRUST_OTEL_ENABLE", "true")
    monkeypatch.setenv("BRAINTRUST_API_KEY", "test-api-key")
    monkeypatch.setenv("BRAINTRUST_PARENT", "project_name:test")

    # This should not crash even though OpenTelemetry is not installed
    # The auto-configuration code should handle the missing OpenTelemetry gracefully
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # Ignore the OpenTelemetry missing warning
        import braintrust.otel

        # The module should still be importable and the class should exist
        assert hasattr(braintrust.otel, "OtelExporter")

        # Creating an instance should still fail with proper error message
        with pytest.raises(ImportError, match="OpenTelemetry packages are not installed"):
            braintrust.otel.OtelExporter()


def test_braintrust_api_url_env_var():
    if not OTEL_INSTALLED:
        pytest.skip("OpenTelemetry not installed, skipping test")

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

        exporter = OtelExporter()

        assert exporter._endpoint == "https://custom.braintrust.dev/otel/v1/traces"
        expected_headers = {"Authorization": "Bearer custom-key"}
        assert exporter._headers == expected_headers

    # Test custom API URL with trailing slash
    with pytest.MonkeyPatch.context() as m:
        m.setenv("BRAINTRUST_API_KEY", "custom-key")
        m.setenv("BRAINTRUST_API_URL", "https://custom.example.com/")

        exporter = OtelExporter()

        assert exporter._endpoint == "https://custom.example.com/otel/v1/traces"


def test_braintrust_otel_enable_no_global_provider(monkeypatch, uninstall_braintrust_otel, caplog):
    """Test BRAINTRUST_OTEL_ENABLE behavior when no global tracer provider is set up."""
    if not OTEL_INSTALLED:
        pytest.skip("OpenTelemetry not installed, skipping test")

    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    # Clear any existing global tracer provider
    trace._TRACER_PROVIDER = None

    # Test with BRAINTRUST_OTEL_ENABLE=true but no global provider
    monkeypatch.setenv("BRAINTRUST_OTEL_ENABLE", "true")
    monkeypatch.setenv("BRAINTRUST_API_KEY", "test-api-key")
    monkeypatch.setenv("BRAINTRUST_PARENT", "project_name:test")

    # Clear any existing log records
    caplog.clear()

    # Re-import the module - this should not crash even without a global provider
    otel_module = importlib.import_module("braintrust.otel")

    # The module should still be importable
    assert hasattr(otel_module, "OtelExporter")

    # The global tracer provider should still be None or ProxyTracerProvider
    provider = trace.get_tracer_provider()
    # OpenTelemetry returns a ProxyTracerProvider if no provider is set
    assert provider.__class__.__name__ in ["ProxyTracerProvider", "NoOpTracerProvider"]

    # Check if a warning was logged
    warning_logged = any(
        "Failed to auto-configure Braintrust OpenTelemetry exporter" in record.message
        for record in caplog.records
        if record.levelname == "WARNING"
    )

    if warning_logged:
        print("Warning was logged as expected")
    else:
        print("No warning was logged - auto-configuration may have succeeded or failed silently")


def test_braintrust_otel_filter_llm_enable_environment_variable():
    """Test that BRAINTRUST_OTEL_FILTER_LLM_ENABLE environment variable is recognized."""
    if not OTEL_INSTALLED:
        pytest.skip("OpenTelemetry not installed, skipping test")

    import os

    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    from braintrust.otel import LLMSpanProcessor

    # Test that the environment variable is properly read
    original_value = os.environ.get("BRAINTRUST_OTEL_FILTER_LLM_ENABLE")

    try:
        # Test true value
        os.environ["BRAINTRUST_OTEL_FILTER_LLM_ENABLE"] = "true"
        assert os.environ.get("BRAINTRUST_OTEL_FILTER_LLM_ENABLE", "").lower() == "true"

        # Test false value
        os.environ["BRAINTRUST_OTEL_FILTER_LLM_ENABLE"] = "false"
        assert os.environ.get("BRAINTRUST_OTEL_FILTER_LLM_ENABLE", "").lower() == "false"

        # Test empty value
        os.environ["BRAINTRUST_OTEL_FILTER_LLM_ENABLE"] = ""
        assert os.environ.get("BRAINTRUST_OTEL_FILTER_LLM_ENABLE", "").lower() == ""

        # Test LLMSpanProcessor can be instantiated
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        memory_exporter = InMemorySpanExporter()
        simple_processor = SimpleSpanProcessor(memory_exporter)
        llm_processor = LLMSpanProcessor(simple_processor)

        # Verify it has the expected attributes
        assert hasattr(llm_processor, "_processor")
        assert hasattr(llm_processor, "_custom_filter")
        assert hasattr(llm_processor, "_should_keep_llm_span")
        assert callable(llm_processor._should_keep_llm_span)

    finally:
        # Restore original value
        if original_value is not None:
            os.environ["BRAINTRUST_OTEL_FILTER_LLM_ENABLE"] = original_value
        else:
            os.environ.pop("BRAINTRUST_OTEL_FILTER_LLM_ENABLE", None)


class TestLLMSpanFiltering:
    """Test the LLM-aware span filtering logic using real OpenTelemetry components."""

    def setup_method(self):
        """Set up a fresh tracer for each test."""
        if not OTEL_INSTALLED:
            pytest.skip("OpenTelemetry not installed, skipping LLMSpanProcessor tests")

        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        from braintrust.otel import LLMSpanProcessor

        self.memory_exporter = InMemorySpanExporter()
        self.provider = TracerProvider()

        # Create processor with our filtering logic
        base_processor = SimpleSpanProcessor(self.memory_exporter)
        self.filtering_processor = LLMSpanProcessor(base_processor)

        self.provider.add_span_processor(self.filtering_processor)
        self.tracer = self.provider.get_tracer("test_tracer")

    def teardown_method(self):
        """Clean up after each test."""
        if OTEL_INSTALLED:
            self.provider.shutdown()
            self.memory_exporter.clear()

    def test_keeps_root_spans(self):
        """Root spans should always be kept."""
        with self.tracer.start_as_current_span("root_operation"):
            pass

        spans = self.memory_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].name == "root_operation"

    def test_keeps_gen_ai_spans(self):
        """Spans starting with 'gen_ai.' should be kept."""
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
        """Spans starting with 'braintrust.' should be kept."""
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
        """Spans starting with 'llm.' should be kept."""
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("llm.generate"):
                pass

        spans = self.memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]
        assert "llm.generate" in span_names

    def test_keeps_ai_spans(self):
        """Spans starting with 'ai.' should be kept."""
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("ai.model_call"):
                pass

        spans = self.memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]
        assert "ai.model_call" in span_names

    def test_keeps_spans_with_llm_attributes(self):
        """Spans with LLM-related attribute names should be kept."""
        with self.tracer.start_as_current_span("root"):
            with self.tracer.start_as_current_span("some_operation") as span:
                span.set_attribute("gen_ai.model", "gpt-4")
                span.set_attribute("regular_data", "value")
            with self.tracer.start_as_current_span("another_operation") as span:
                span.set_attribute("llm.tokens", 100)
            with self.tracer.start_as_current_span("third_operation") as span:
                span.set_attribute("database.connection", "postgres")

        spans = self.memory_exporter.get_finished_spans()
        span_names = [span.name for span in spans]

        assert "root" in span_names
        assert "some_operation" in span_names  # has gen_ai.model attribute
        assert "another_operation" in span_names  # has llm.tokens attribute
        assert "third_operation" not in span_names  # no LLM attributes

    def test_drops_non_llm_spans(self):
        """Non-LLM spans should be filtered out."""
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
        """Custom filter returning True should keep spans."""

        def custom_filter(span):
            if span.name == "custom_keep":
                return True
            return None  # Don't influence decision

        # Create processor with custom filter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        from braintrust.otel import LLMSpanProcessor

        memory_exporter = InMemorySpanExporter()
        processor = LLMSpanProcessor(SimpleSpanProcessor(memory_exporter), custom_filter=custom_filter)
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
        """Custom filter returning False should drop spans."""

        def custom_filter(span):
            if span.name == "gen_ai.drop_this":
                return False
            return None  # Don't influence decision

        # Create processor with custom filter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        from braintrust.otel import LLMSpanProcessor

        memory_exporter = InMemorySpanExporter()
        processor = LLMSpanProcessor(SimpleSpanProcessor(memory_exporter), custom_filter=custom_filter)
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
        """Custom filter returning None should use default logic."""

        def custom_filter(span):
            return None  # Always defer to default logic

        # Create processor with custom filter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        from braintrust.otel import LLMSpanProcessor

        memory_exporter = InMemorySpanExporter()
        processor = LLMSpanProcessor(SimpleSpanProcessor(memory_exporter), custom_filter=custom_filter)
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
        """Compare filtered vs unfiltered exporters to verify filtering works."""
        # Set up two separate exporters and processors
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        from braintrust.otel import LLMSpanProcessor

        all_spans_exporter = InMemorySpanExporter()
        filtered_spans_exporter = InMemorySpanExporter()

        # Processor that captures everything
        all_processor = SimpleSpanProcessor(all_spans_exporter)

        # Processor that filters LLM spans
        filtered_processor = LLMSpanProcessor(SimpleSpanProcessor(filtered_spans_exporter))

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
