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
import os
import time
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import Mock

import braintrust
import openai
import pytest
import yaml
from braintrust import wrap_openai
from braintrust.otel import BraintrustSpanProcessor
from opentelemetry import trace
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

    def _setup_otel_capture(self) -> tuple[InMemorySpanExporter, TracerProvider]:
        """Set up OpenTelemetry to capture spans in memory."""
        # Enable OTel compatibility mode for Braintrust
        os.environ['BRAINTRUST_OTEL_COMPAT'] = 'true'

        # TODO -- if python sdk ever supports otel instrumentation stop using init_logger
        braintrust.init_logger(project="sdk-spec-test")
        # Create TracerProvider and set it as global
        provider = TracerProvider()
        exporter = InMemorySpanExporter()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        provider.add_span_processor(BraintrustSpanProcessor(parent="project_name:sdk-spec-test"))
        trace.set_tracer_provider(provider)

        return exporter, provider

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
            if len(matching_spans) == 0:
                # Format captured span data for error message
                captured_span_info = []
                for span in spans:
                    span_dict = {
                        "name": span.name,
                        "attributes": dict(span.attributes) if hasattr(span, "attributes") else {},
                        "status": str(span.status) if hasattr(span, "status") else None,
                    }
                    captured_span_info.append(span_dict)

                error_msg = f"No span found with name: {span_name}\n\n"
                error_msg += f"Captured {len(spans)} span(s):\n"
                error_msg += json.dumps(captured_span_info, indent=2)
                assert False, error_msg

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

    def _get_project_id(self, project_name: str) -> str:
        """Get project UUID from project name."""
        import requests

        api_key = os.getenv("BRAINTRUST_API_KEY")
        if not api_key:
            raise ValueError("BRAINTRUST_API_KEY environment variable not set")

        api_url = os.getenv("BRAINTRUST_API_URL", "https://api.braintrust.dev")

        # Fetch projects
        url = f"{api_url}/v1/project"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        response = requests.get(url, headers=headers, params={"project_name": project_name})
        response.raise_for_status()

        data = response.json()
        projects = data.get("objects", [])

        matching = [p for p in projects if p.get("name") == project_name]
        if not matching:
            raise ValueError(f"Project not found: {project_name}")

        return matching[0]["id"]

    def _fetch_braintrust_span(self, root_span_id: str, project_id: str) -> Dict[str, Any]:
        """Fetch span data from Braintrust API by root_span_id.

        Returns the child span (not the root span itself).
        """
        import requests

        api_key = os.getenv("BRAINTRUST_API_KEY")
        if not api_key:
            raise ValueError("BRAINTRUST_API_KEY environment variable not set")

        api_url = os.getenv("BRAINTRUST_API_URL", "https://api.braintrust.dev")

        # Fetch all events with this root_span_id
        url = f"{api_url}/v1/project_logs/{project_id}/fetch"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        # Fetch with limit - we expect root span + 1 child
        response = requests.post(url, headers=headers, json={"limit": 10})
        response.raise_for_status()

        data = response.json()
        events = data.get("events", [])

        # Filter events by root_span_id
        trace_events = [e for e in events if e.get("id") == root_span_id]

        if len(trace_events) == 0:
            raise ValueError(f"No events found with root_span_id: {root_span_id}")

        # Find the child span (not the root)
        child_spans = [e for e in trace_events if not e.get("is_root", False)]

        if len(child_spans) == 0:
            raise ValueError(f"No child spans found for root_span_id: {root_span_id}")

        if len(child_spans) > 1:
            print(f"Warning: Found {len(child_spans)} child spans, expected 1. Using first.")

        return child_spans[0]

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
        exporter, provider = self._setup_otel_capture()

        # Mock the HTTP response
        mock_response = self._mock_http_response(wiremock_config)

        root_span_id = ""
        # Execute the SDK call
        if vendor == "OpenAI" and endpoint == "completions":
            # Initialize Braintrust logger
            logger = braintrust.init_logger(project="sdk-spec-test", set_current=True)

            # Create a parent span to capture the trace
            with logger.start_span(name=test_spec["name"]) as parent_span:
                # Make the API call (will be automatically traced as child span)
                client = wrap_openai(openai.OpenAI())
                response = client.chat.completions.create(**request)

            # Flush to send to Braintrust API
            logger.flush()

            # Store the span ID for fetching trace data
            root_span_id = parent_span.id
            # print(f"Trace ID: {trace_id}")
            # print(f"Permalink: {parent_span.permalink()}")
        else:
            # TODO: Implement other vendor/endpoint combinations
            pass

        # Validate OTel spans
        captured_spans = exporter.get_finished_spans()
        # NOTE: python sdk does not instrument in otel so we'll skip otel validation
        # if "otel_span" in test_spec:
        #     self._validate_otel_span(captured_spans, test_spec["otel_span"])

        # Validate Braintrust spans (if specified)
        if "braintrust_span" in test_spec and root_span_id:
            # Fetch actual span data from Braintrust API
            # We need to get the project UUID from the project name
            # TODO cache project id
            project_name = "sdk-spec-test"
            project_id = self._get_project_id(project_name)

            # Give the API a moment to process the data
            time.sleep(5)
            span_data = self._fetch_braintrust_span(root_span_id, project_id)
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
