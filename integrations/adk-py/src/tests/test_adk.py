import json
import os

import pytest
import yaml
from braintrust.logger import flush
from braintrust_adk import setup_braintrust
from google.adk import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

os.environ["BRAINTRUST_SYNC_FLUSH"] = "1"


setup_braintrust(project_name="test_adk")


@pytest.fixture(scope="module")
def vcr_config():
    return {
        "filter_headers": [
            "authorization",
            "x-goog-api-key",
        ]
    }


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_adk_braintrust_integration():
    def get_weather(location: str):
        """Get the weather for a location."""
        return {
            "location": location,
            "temperature": "72°F",
            "condition": "sunny",
            "humidity": "45%",
            "wind": "5 mph NW",
        }

    agent = Agent(
        name="weather_agent",
        model="gemini-2.0-flash",
        instruction="You are a helpful weather assistant. Use the get_weather tool to answer questions about weather.",
        tools=[get_weather],
    )

    # Set up session
    APP_NAME = "weather_app"
    USER_ID = "test-user"
    SESSION_ID = "test-session"

    session_service = InMemorySessionService()
    await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID)

    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)

    user_msg = types.Content(role="user", parts=[types.Part(text="What's the weather in San Francisco?")])

    responses = []
    async for event in runner.run_async(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
        if event.is_final_response():
            responses.append(event)

    assert len(responses) > 0
    assert responses[0].content
    assert responses[0].content.parts

    response_text = responses[0].content.parts[0].text
    assert any(word in response_text.lower() for word in ["weather", "san francisco", "72", "sunny"]), (
        f"Response doesn't mention weather: {response_text}"
    )

    flush()

    # Read and parse the cassette file to verify logged data
    cassette_path = os.path.join(os.path.dirname(__file__), "cassettes", "test_adk_braintrust_integration.yaml")
    with open(cassette_path, "r") as f:
        cassette_data = yaml.safe_load(f)

    # Find the POST request to /logs3
    logs_requests = [
        interaction
        for interaction in cassette_data["interactions"]
        if interaction["request"]["uri"].endswith("/logs3") and interaction["request"]["method"] == "POST"
    ]

    assert len(logs_requests) > 0, "No POST requests to /logs3 found in cassette"

    # Parse the first logs request body
    log_payload = json.loads(logs_requests[0]["request"]["body"])

    assert "rows" in log_payload, "Missing 'rows' in log payload"
    assert len(log_payload["rows"]) > 0, "No rows in log payload"

    # Check that we have the expected span types
    span_types = {row["span_attributes"]["type"] for row in log_payload["rows"]}
    assert "task" in span_types, "Missing 'task' spans"
    assert "llm" in span_types, "Missing 'llm' spans"

    # Verify the invocation span
    invocation_spans = [
        row for row in log_payload["rows"] if row["span_attributes"]["name"] == "invocation [weather_app]"
    ]
    assert len(invocation_spans) > 0, "Missing invocation span"
    invocation_span = invocation_spans[0]

    # Check invocation input
    assert "input" in invocation_span, "Missing input in invocation span"
    assert "new_message" in invocation_span["input"], "Missing new_message in input"
    assert invocation_span["input"]["new_message"]["parts"][0]["text"] == "What's the weather in San Francisco?"

    # Check metadata
    assert "metadata" in invocation_span, "Missing metadata in invocation span"
    assert invocation_span["metadata"]["user_id"] == "test-user"
    assert invocation_span["metadata"]["session_id"] == "test-session"

    # Verify LLM call spans
    llm_spans = [row for row in log_payload["rows"] if row["span_attributes"]["type"] == "llm"]
    assert len(llm_spans) >= 2, "Should have at least 2 LLM calls (tool selection and response generation)"

    # Check tool selection LLM call
    tool_selection_spans = [span for span in llm_spans if "tool_selection" in span["span_attributes"]["name"]]
    assert len(tool_selection_spans) > 0, "Missing tool selection LLM call"

    tool_selection_span = tool_selection_spans[0]
    assert "output" in tool_selection_span, "Missing output in tool selection span"
    assert "content" in tool_selection_span["output"], "Missing content in tool selection output"
    # Verify it called the get_weather function
    function_call = tool_selection_span["output"]["content"]["parts"][0]["function_call"]
    assert function_call["name"] == "get_weather"
    assert function_call["args"]["location"] == "San Francisco"

    # Check response generation LLM call
    response_gen_spans = [span for span in llm_spans if "response_generation" in span["span_attributes"]["name"]]
    assert len(response_gen_spans) > 0, "Missing response generation LLM call"

    response_span = response_gen_spans[0]
    assert "output" in response_span, "Missing output in response generation span"
    response_output = response_span["output"]["content"]["parts"][0]["text"]
    assert "san francisco" in response_output.lower(), "Response doesn't mention San Francisco"
    assert "72" in response_output, "Response doesn't mention temperature"

    # Verify span relationships
    root_span_ids = set()
    for row in log_payload["rows"]:
        assert "span_id" in row, "Missing span_id"
        assert "root_span_id" in row, "Missing root_span_id"
        assert row["root_span_id"], "Empty root_span_id"
        root_span_ids.add(row["root_span_id"])

    # All spans should share the same root
    assert len(root_span_ids) == 1, f"Multiple root spans found: {root_span_ids}"

    # Verify the API version
    assert log_payload.get("api_version") == 2, "Expected API version 2"
