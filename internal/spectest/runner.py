"""
Test runner for cross-language SDK spec tests.

This runner:
1. Loads YAML test specifications from sdkspec/test/
2. Mocks HTTP responses using the wiremock configuration
3. Executes SDK calls against the mocked endpoints
4. Captures and validates OpenTelemetry spans
5. Optionally validates Braintrust API spans
"""

import json
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import Mock, patch

import pytest
import yaml
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


class SpecTestRunner:
    """Runner for SDK specification tests."""

    def __init__(self, spec_path: Path):
        """Initialize the runner with a path to a YAML spec file."""
        self.spec_path = spec_path
        self.spec = self._load_spec()

    def _load_spec(self) -> Dict[str, Any]:
        """Load the YAML test specification."""
        with open(self.spec_path) as f:
            return yaml.safe_load(f)

    def _setup_otel_capture(self) -> InMemorySpanExporter:
        """Set up OpenTelemetry to capture spans in memory."""
        exporter = InMemorySpanExporter()
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        return exporter

    def _mock_http_response(self, wiremock_config: Dict[str, Any]) -> Mock:
        """Create a mock HTTP response from wiremock configuration."""
        response_config = wiremock_config["response"]
        mock_response = Mock()
        mock_response.status_code = response_config["status"]
        mock_response.headers = response_config.get("headers", {})
        mock_response.json.return_value = response_config["body"]
        mock_response.text = json.dumps(response_config["body"])
        return mock_response

    def _validate_otel_span(self, spans: List[Any], expected: Dict[str, Any]) -> None:
        """Validate that captured OTel spans match expected attributes."""
        if not expected:
            return

        span_name = expected.get("span_name")
        required_attrs = expected.get("required_attributes", [])

        # Find span by name if specified
        matching_spans = spans
        if span_name:
            matching_spans = [s for s in spans if s.name == span_name]
            assert len(matching_spans) > 0, f"No span found with name: {span_name}"

        # Validate required attributes
        for attr_config in required_attrs:
            attr_list = attr_config.get("attribute", [])
            # Parse attribute name and value
            attr_name = next((item["name"] for item in attr_list if "name" in item), None)
            attr_value = next((item["value"] for item in attr_list if "value" in item), None)

            if attr_name and attr_value:
                found = False
                for span in matching_spans:
                    if hasattr(span, "attributes") and span.attributes.get(attr_name) == attr_value:
                        found = True
                        break
                assert found, f"Required attribute not found: {attr_name}={attr_value}"

    def _validate_braintrust_span(self, span_data: Dict[str, Any], expected: Dict[str, Any]) -> None:
        """Validate that Braintrust span data matches expected structure."""
        if not expected:
            return

        # Validate metadata
        expected_metadata = expected.get("metadata", [])
        for meta_item in expected_metadata:
            for key, value in meta_item.items():
                assert span_data.get("metadata", {}).get(key) == value, \
                    f"Metadata mismatch: {key}={value}"

        # Validate span attributes
        expected_attrs = expected.get("span_attributes", {})
        for key, value in expected_attrs.items():
            assert span_data.get(key) == value, f"Span attribute mismatch: {key}={value}"

    def run_test(self, test_spec: Dict[str, Any]) -> None:
        """Run a single test from the specification."""
        vendor = test_spec["vendor"]
        endpoint = test_spec["endpoint"]
        request = test_spec["request"]
        wiremock_str = test_spec.get("wiremock", "{}")
        wiremock_config = json.loads(wiremock_str)

        # Set up OTel capture
        exporter = self._setup_otel_capture()

        # Mock the HTTP response
        mock_response = self._mock_http_response(wiremock_config)

        # Execute the SDK call with mocked response
        with patch("requests.post", return_value=mock_response):
            # TODO: Actually invoke the SDK based on vendor/endpoint
            # For now, this is a placeholder
            if vendor == "OpenAI" and endpoint == "completions":
                # import openai
                # client = openai.OpenAI(base_url="http://localhost:8080")
                # client.chat.completions.create(**request)
                pass

        # Validate OTel spans
        captured_spans = exporter.get_finished_spans()
        if "otel_span" in test_spec:
            self._validate_otel_span(captured_spans, test_spec["otel_span"])

        # Validate Braintrust spans (if specified)
        if "braintrust_span" in test_spec:
            # TODO: Fetch actual span data from Braintrust API or local logs
            span_data = {}
            self._validate_braintrust_span(span_data, test_spec["braintrust_span"])

    def run_all_tests(self) -> None:
        """Run all tests in the specification."""
        test_name = self.spec.get("name", "Unknown")
        tests = self.spec.get("tests", [])

        print(f"Running test suite: {test_name}")
        print(f"Found {len(tests)} test(s)")

        for test in tests:
            test_name = test.get("name", "Unnamed test")
            print(f"  Running: {test_name}")
            try:
                self.run_test(test)
                print(f"    ✓ {test_name} passed")
            except AssertionError as e:
                print(f"    ✗ {test_name} failed: {e}")
                raise


def pytest_collect_file(parent, file_path):
    """Pytest hook to collect YAML spec files as tests."""
    if file_path.suffix == ".yaml" and "sdkspec/test" in str(file_path):
        return SpecTestFile.from_parent(parent, path=file_path)


class SpecTestFile(pytest.File):
    """Pytest file node for YAML spec files."""

    def collect(self):
        """Collect individual tests from the YAML spec."""
        runner = SpecTestRunner(self.path)
        for test_spec in runner.spec.get("tests", []):
            yield SpecTestItem.from_parent(self, name=test_spec["name"], runner=runner, test_spec=test_spec)


class SpecTestItem(pytest.Item):
    """Pytest item representing a single spec test."""

    def __init__(self, name, parent, runner, test_spec):
        super().__init__(name, parent)
        self.runner = runner
        self.test_spec = test_spec

    def runtest(self):
        """Execute the test."""
        self.runner.run_test(self.test_spec)

    def repr_failure(self, excinfo):
        """Represent test failures."""
        return f"Spec test failed: {excinfo.value}"

    def reportinfo(self):
        """Report test information."""
        return self.fspath, 0, f"spec: {self.name}"


if __name__ == "__main__":
    # Can be run directly for debugging
    import sys

    if len(sys.argv) < 2:
        print("Usage: python runner.py <path-to-spec.yaml>")
        sys.exit(1)

    spec_path = Path(sys.argv[1])
    runner = SpecTestRunner(spec_path)
    runner.run_all_tests()
