import json
import os
from pathlib import Path
from typing import Any

import pytest
from braintrust.framework import _evals
from braintrust.test_helpers import has_devserver_installed


@pytest.fixture
def client():
    """Create test client using the real simple_eval.py example."""
    # Skip if devserver dependencies are not installed
    if not has_devserver_installed():
        pytest.skip("Devserver dependencies not installed (requires .[cli])")

    # Import CLI dependencies inside the fixture
    from braintrust.devserver.server import create_app
    from starlette.testclient import TestClient

    # Use the real simple_eval.py example
    eval_file = Path(__file__).parent.parent.parent.parent / "examples" / "evals" / "simple_eval.py"

    # Clear any existing evaluators
    _evals.clear()

    # Load the eval file to register evaluators (but don't run them)
    spec = __import__("importlib.util").util.spec_from_file_location("simple_eval", str(eval_file))
    module = __import__("importlib.util").util.module_from_spec(spec)

    # Get evaluators from the module without executing Eval()
    # We need to parse the file and extract the Evaluator definition
    import re

    from braintrust import Evaluator

    def task(input: str, hooks) -> str:
        """Simple math task."""
        match = re.search(r"(\d+)\+(\d+)", input)
        if match:
            return str(int(match.group(1)) + int(match.group(2)))
        return "I don't know"

    def scorer(input: str, output: str, expected: str) -> float:
        """Simple exact match scorer."""
        return 1.0 if output == expected else 0.0

    evaluator = Evaluator(
        project_name="test-math-eval",
        eval_name="simple-math-eval",
        data=lambda: [
            {"input": "What is 2+2?", "expected": "4"},
            {"input": "What is 3+3?", "expected": "6"},
            {"input": "What is 5+5?", "expected": "10"},
        ],
        task=task,
        scores=[scorer],
        experiment_name=None,
        metadata=None,
    )

    # Create app with the evaluator
    app = create_app([evaluator])
    return TestClient(app)


@pytest.fixture
def api_key():
    """Provide test API key."""
    return os.getenv("BRAINTRUST_API_KEY", "test-api-key")


@pytest.fixture
def org_name():
    """Provide test org name."""
    return os.getenv("BRAINTRUST_ORG_NAME", "matt-test-org")


def test_devserver_health_check(client):
    """Test that server responds to health check."""
    response = client.get("/")
    assert response.status_code == 200
    assert response.text == "Hello, world!"


@pytest.mark.vcr
def test_devserver_list_evaluators(client, api_key, org_name):
    """Test listing evaluators endpoint."""
    response = client.get("/list", headers={"x-bt-auth-token": api_key, "x-bt-org-name": org_name})
    assert response.status_code == 200
    evaluators = response.json()
    assert "simple-math-eval" in evaluators


def parse_sse_events(response_text: str) -> list[dict[str, Any]]:
    """Parse SSE events from response text."""
    events = []
    lines = response_text.strip().split("\n")
    i = 0

    while i < len(lines):
        if lines[i].startswith("event: "):
            event_type = lines[i][7:].strip()
            i += 1

            if i < len(lines) and lines[i].startswith("data: "):
                data_str = lines[i][6:].strip()
                try:
                    data = json.loads(data_str) if data_str else None
                except json.JSONDecodeError:
                    data = data_str

                events.append({"event": event_type, "data": data})
                i += 1
            else:
                events.append({"event": event_type, "data": None})
        else:
            i += 1

    return events


@pytest.mark.skip
@pytest.mark.vcr
def test_eval_sse_streaming(client, api_key, org_name):
    """
    Comprehensive test for SSE streaming during eval execution.

    Verifies:
    1. Event order: start → progress* → summary → done
    2. Progress events are emitted
    3. Start event has metadata (experimentName, projectName)
    4. Summary event has camelCase fields (not snake_case)
    5. Response format is correct
    """
    response = client.post(
        "/eval",
        headers={
            "x-bt-auth-token": api_key,
            "x-bt-org-name": org_name,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        json={
            "name": "simple-math-eval",
            "stream": True,
            "data": [
                {"input": "What is 2+2?", "expected": "4"},
                {"input": "What is 3+3?", "expected": "6"},
            ],
        },
    )

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/event-stream; charset=utf-8"

    events = parse_sse_events(response.text)
    event_types = [e["event"] for e in events]

    # Verify event order
    assert len(event_types) > 0
    assert event_types[0] == "start"
    assert event_types[-1] == "done"
    assert "summary" in event_types

    # Verify progress events exist
    progress_events = [e for e in events if e["event"] == "progress"]
    assert len(progress_events) > 0

    # Verify start event has metadata
    start_event = next(e for e in events if e["event"] == "start")
    assert "experimentName" in start_event["data"]
    assert "projectName" in start_event["data"]

    # Verify summary event has camelCase fields
    summary_event = next(e for e in events if e["event"] == "summary")
    assert summary_event is not None
    summary_data = summary_event["data"]
    assert summary_data is not None

    assert "experimentName" in summary_data
    assert "projectName" in summary_data
    assert "scores" in summary_data

    # Should NOT have snake_case fields
    assert "experiment_name" not in summary_data
    assert "project_name" not in summary_data


@pytest.mark.vcr
def test_eval_error_handling(client, api_key, org_name):
    """Test error handling for non-existent evaluator."""
    response = client.post(
        "/eval",
        headers={
            "x-bt-auth-token": api_key,
            "x-bt-org-name": org_name,
            "Content-Type": "application/json",
        },
        json={"name": "non-existent-eval", "stream": False},
    )

    assert response.status_code == 404
    error = response.json()
    assert "error" in error
    assert "not found" in error["error"].lower()
