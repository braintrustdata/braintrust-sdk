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
