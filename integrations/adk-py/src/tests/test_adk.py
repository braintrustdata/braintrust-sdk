from pathlib import Path

import pytest
from google.adk import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from braintrust import logger
from braintrust.logger import Attachment
from braintrust.test_helpers import init_test_logger
from braintrust_adk import setup_adk

PROJECT_NAME = "test_adk"

setup_adk(project_name=PROJECT_NAME)


@pytest.fixture(scope="module")
def vcr_config():
    return {
        "record_mode": "once",
        "filter_headers": [
            "authorization",
            "x-goog-api-key",
        ],
    }


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_adk_braintrust_integration(memory_logger):
    assert not memory_logger.pop()

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

    spans = memory_logger.pop()

    # Check that we have the expected span types
    span_types = {row["span_attributes"]["type"] for row in spans}
    assert "task" in span_types, "Missing 'task' spans"
    assert "llm" in span_types, "Missing 'llm' spans"

    # Verify the invocation span
    invocation_spans = [row for row in spans if row["span_attributes"]["name"] == "invocation [weather_app]"]
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
    llm_spans = [row for row in spans if row["span_attributes"]["type"] == "llm"]
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


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_adk_max_tokens_captures_content(memory_logger):
    """Test that content is captured even when MAX_TOKENS finish reason occurs."""
    assert not memory_logger.pop()

    agent = Agent(
        name="creative_agent",
        model="gemini-2.0-flash",
        instruction="You are a creative storyteller.",
        generate_content_config=types.GenerateContentConfig(
            max_output_tokens=50,  # Set low to trigger MAX_TOKENS
            temperature=0.7,
        ),
    )

    APP_NAME = "creative_app"
    USER_ID = "test-user"
    SESSION_ID = "test-session-max-tokens"

    session_service = InMemorySessionService()
    await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID)

    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)

    user_msg = types.Content(role="user", parts=[types.Part(text="Tell me a long story about a lighthouse.")])

    responses = []
    async for event in runner.run_async(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
        if event.is_final_response():
            responses.append(event)

    assert len(responses) > 0
    spans = memory_logger.pop()

    # Find the LLM call span
    llm_spans = [row for row in spans if row["span_attributes"]["type"] == "llm"]
    assert len(llm_spans) > 0, "Missing LLM call span"

    llm_span = llm_spans[0]
    assert "output" in llm_span, "Missing output in LLM span"

    output = llm_span["output"]

    # When MAX_TOKENS is hit, we should still have content captured
    # The integration should merge content from earlier events if the final event lacks it
    if "finish_reason" in output and output["finish_reason"] == "MAX_TOKENS":
        # This is the MAX_TOKENS case - verify we still captured content
        assert "content" in output, "Content should be captured even with MAX_TOKENS"
        assert output["content"] is not None, "Content should not be None"
        assert "parts" in output["content"], "Content should have parts"
        assert len(output["content"]["parts"]) > 0, "Content parts should not be empty"

        # Verify the text was actually captured
        text_content = output["content"]["parts"][0].get("text", "")
        assert len(text_content) > 0, "Should have captured some text content before MAX_TOKENS"

        # Verify usage metadata is present
        assert "usage_metadata" in output, "Should have usage metadata"


def test_serialize_content_with_binary_data():
    """Test that _serialize_content converts binary data to Attachment references."""
    from braintrust.logger import Attachment
    from braintrust_adk import _serialize_content, _serialize_part

    # Create a minimal PNG image (1x1 red pixel)
    minimal_png = (
        b"\x89PNG\r\n\x1a\n"  # PNG signature
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde"  # IHDR
        b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x00\x18\xdd\x8d\xb4"  # IDAT
        b"\x00\x00\x00\x00IEND\xaeB`\x82"  # IEND
    )

    # Create a mock Part with inline_data
    class MockBlob:
        def __init__(self, data, mime_type):
            self.data = data
            self.mime_type = mime_type

    class MockPart:
        def __init__(self, inline_data=None, text=None):
            self.inline_data = inline_data
            self.text = text

    # Test serializing a Part with binary data
    part_with_image = MockPart(inline_data=MockBlob(minimal_png, "image/png"))
    serialized_part = _serialize_part(part_with_image)

    # Verify structure
    assert "image_url" in serialized_part, "Should have image_url field"
    assert "url" in serialized_part["image_url"], "Should have url field"

    attachment = serialized_part["image_url"]["url"]
    # The Attachment object should be in the serialized output
    assert isinstance(attachment, Attachment), "Should be an Attachment object"
    assert attachment.reference["type"] == "braintrust_attachment"
    assert attachment.reference["content_type"] == "image/png"
    assert attachment.reference["filename"] == "file.png"
    assert "key" in attachment.reference

    # Test serializing a Part with text
    part_with_text = MockPart(text="Hello, world!")
    serialized_text_part = _serialize_part(part_with_text)
    assert serialized_text_part == {"text": "Hello, world!"}, "Text part should serialize correctly"

    # Test serializing Content with multiple parts
    class MockContent:
        def __init__(self, parts, role):
            self.parts = parts
            self.role = role

    content = MockContent(
        parts=[
            MockPart(inline_data=MockBlob(minimal_png, "image/png")),
            MockPart(text="What's in this image?"),
        ],
        role="user",
    )

    serialized_content = _serialize_content(content)
    assert "parts" in serialized_content
    assert "role" in serialized_content
    assert serialized_content["role"] == "user"
    assert len(serialized_content["parts"]) == 2

    # First part should be the image as Attachment
    assert "image_url" in serialized_content["parts"][0]
    assert isinstance(serialized_content["parts"][0]["image_url"]["url"], Attachment)

    # Second part should be text
    assert serialized_content["parts"][1] == {"text": "What's in this image?"}


def test_serialize_part_with_file_data():
    """Test that _serialize_part handles file_data (file references) correctly."""
    from braintrust_adk import _serialize_part

    class MockFileData:
        def __init__(self, file_uri, mime_type):
            self.file_uri = file_uri
            self.mime_type = mime_type

    class MockPart:
        def __init__(self, file_data=None, text=None):
            self.file_data = file_data
            self.text = text

    # Test serializing a Part with file_data
    part_with_file = MockPart(file_data=MockFileData("gs://bucket/file.pdf", "application/pdf"))
    serialized_part = _serialize_part(part_with_file)

    assert "file_data" in serialized_part
    assert serialized_part["file_data"]["file_uri"] == "gs://bucket/file.pdf"
    assert serialized_part["file_data"]["mime_type"] == "application/pdf"


def test_serialize_part_with_dict():
    """Test that _serialize_part handles dict input correctly."""
    from braintrust_adk import _serialize_part

    # Test that dicts pass through unchanged
    dict_part = {"text": "Hello", "custom": "field"}
    serialized = _serialize_part(dict_part)
    assert serialized == dict_part, "Dict should pass through unchanged"


def test_serialize_content_with_none():
    """Test that _serialize_content handles None correctly."""
    from braintrust_adk import _serialize_content

    result = _serialize_content(None)
    assert result is None, "None should serialize to None"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_adk_binary_data_attachment_conversion(memory_logger):
    """Test that binary data in messages is converted to Attachment references."""
    assert not memory_logger.pop()

    agent = Agent(
        name="vision_agent",
        model="gemini-2.0-flash",
        instruction="You are a helpful assistant that can analyze images.",
        generate_content_config=types.GenerateContentConfig(
            max_output_tokens=150,
        ),
    )

    APP_NAME = "vision_app"
    USER_ID = "test-user"
    SESSION_ID = "test-session-image"

    session_service = InMemorySessionService()
    await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID)

    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)

    # Load test image from fixtures
    fixtures_dir = Path(__file__).parent.parent.parent.parent.parent / "internal" / "golden" / "fixtures"
    image_path = fixtures_dir / "test-image.png"
    with open(image_path, "rb") as f:
        image_data = f.read()

    # Create message with inline binary data
    user_msg = types.Content(
        role="user",
        parts=[
            types.Part(inline_data=types.Blob(mime_type="image/png", data=image_data)),
            types.Part(text="What color is this image?"),
        ],
    )

    responses = []
    async for event in runner.run_async(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
        if event.is_final_response():
            responses.append(event)

    assert len(responses) > 0

    spans = memory_logger.pop()

    # Find the invocation span
    invocation_spans = [row for row in spans if row["span_attributes"]["name"] == "invocation [vision_app]"]
    assert len(invocation_spans) > 0, "Missing invocation span"
    invocation_span = invocation_spans[0]

    # Verify the input contains properly serialized content
    assert "input" in invocation_span, "Missing input in invocation span"
    assert "new_message" in invocation_span["input"], "Missing new_message in input"

    new_message = invocation_span["input"]["new_message"]
    assert "parts" in new_message, "Missing parts in new_message"
    assert len(new_message["parts"]) == 2, "Should have 2 parts (image and text)"

    # First part should be the image as an Attachment reference
    image_part = new_message["parts"][0]
    assert "image_url" in image_part, "Image part should have image_url field"
    assert "url" in image_part["image_url"], "image_url should have url field"

    attachment_ref = image_part["image_url"]["url"]
    # Verify it's an Attachment object, not raw binary data
    assert isinstance(attachment_ref, Attachment), "Attachment should be an Attachment object"
    ref = attachment_ref.reference
    assert "key" in ref, "Attachment reference should have a key"
    assert "filename" in ref, "Attachment reference should have a filename"
    assert "content_type" in ref, "Attachment reference should have a content_type"
    assert ref["content_type"] == "image/png", "Content type should be image/png"
    assert ref["filename"] == "file.png", "Filename should be file.png"

    # Second part should be the text
    text_part = new_message["parts"][1]
    assert "text" in text_part, "Second part should have text"
    assert text_part["text"] == "What color is this image?", "Text content should match"

    # Verify no raw binary data is present in the logged span
    span_str = str(invocation_span)
    # Check that the binary PNG signature is NOT in the logged data
    assert b"\x89PNG".hex() not in span_str, "Raw binary data should not be in logged span"
    assert "89504e47" not in span_str.lower(), "Raw binary data (hex) should not be in logged span"

    # Find LLM spans and verify they also don't contain raw binary
    llm_spans = [row for row in spans if row["span_attributes"]["type"] == "llm"]
    assert len(llm_spans) > 0, "Should have LLM spans"

    for llm_span in llm_spans:
        if "input" in llm_span and "contents" in llm_span["input"]:
            llm_str = str(llm_span["input"])
            assert b"\x89PNG".hex() not in llm_str, "Raw binary data should not be in LLM span input"
            assert "89504e47" not in llm_str.lower(), "Raw binary data (hex) should not be in LLM span input"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_adk_captures_metrics(memory_logger):
    """Test that token usage metrics are captured from LLM responses."""
    assert not memory_logger.pop()

    agent = Agent(
        name="metrics_agent",
        model="gemini-2.0-flash",
        instruction="You are a helpful assistant.",
    )

    APP_NAME = "metrics_app"
    USER_ID = "test-user"
    SESSION_ID = "test-session-metrics"

    session_service = InMemorySessionService()
    await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID)

    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)

    user_msg = types.Content(role="user", parts=[types.Part(text="Say hello in 3 words")])

    responses = []
    async for event in runner.run_async(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
        if event.is_final_response():
            responses.append(event)

    assert len(responses) > 0

    spans = memory_logger.pop()

    # Find LLM spans
    llm_spans = [row for row in spans if row["span_attributes"].get("type") == "llm"]
    assert len(llm_spans) > 0, "Should have LLM spans"

    # Verify metrics are present in at least one LLM span
    llm_span_with_metrics = None
    for llm_span in llm_spans:
        if "metrics" in llm_span and llm_span["metrics"]:
            llm_span_with_metrics = llm_span
            break

    assert llm_span_with_metrics is not None, "At least one LLM span should have metrics"

    metrics = llm_span_with_metrics["metrics"]

    # Verify core token metrics are present
    assert "prompt_tokens" in metrics, "Metrics should include prompt_tokens"
    assert "completion_tokens" in metrics, "Metrics should include completion_tokens"
    assert "tokens" in metrics, "Metrics should include total tokens"

    # Verify token counts are reasonable
    assert metrics["prompt_tokens"] > 0, "prompt_tokens should be greater than 0"
    assert metrics["completion_tokens"] > 0, "completion_tokens should be greater than 0"
    assert metrics["tokens"] > 0, "total tokens should be greater than 0"
    assert metrics["tokens"] == metrics["prompt_tokens"] + metrics["completion_tokens"], (
        "total tokens should equal prompt + completion tokens"
    )

    # Verify time to first token is captured for streaming responses
    assert "time_to_first_token" in metrics, "Metrics should include time_to_first_token"
    assert metrics["time_to_first_token"] > 0, "time_to_first_token should be greater than 0"
    assert metrics["time_to_first_token"] < 10, "time_to_first_token should be reasonable (< 10 seconds)"

    # Verify model name is captured in metadata
    metadata = llm_span_with_metrics.get("metadata", {})
    assert "model" in metadata, "Metadata should include model name"
    assert metadata["model"] == "gemini-2.0-flash", "Model name should match the agent's model"


def test_determine_llm_call_type_direct_response():
    """Test that _determine_llm_call_type returns 'direct_response' when tools are available but not used."""
    from braintrust_adk import _determine_llm_call_type

    # Request with tools available
    llm_request = {
        "config": {
            "tools": [
                {
                    "function_declarations": [
                        {"name": "read_file", "description": "Read a file"},
                        {"name": "list_directory", "description": "List directory"},
                    ]
                }
            ]
        },
        "contents": [{"parts": [{"text": "What is 2+2?"}], "role": "user"}],
    }

    # Response without function calls
    model_response = {
        "content": {"parts": [{"text": "4\n"}], "role": "model"},
        "finish_reason": "STOP",
    }

    call_type = _determine_llm_call_type(llm_request, model_response)
    assert call_type == "direct_response", "Should be direct_response when tools available but not used"


def test_determine_llm_call_type_tool_selection():
    """Test that _determine_llm_call_type returns 'tool_selection' when LLM calls a tool."""
    from braintrust_adk import _determine_llm_call_type

    # Request with tools available
    llm_request = {
        "config": {
            "tools": [
                {
                    "function_declarations": [
                        {"name": "get_weather", "description": "Get weather"},
                    ]
                }
            ]
        },
        "contents": [{"parts": [{"text": "What's the weather?"}], "role": "user"}],
    }

    # Response with function call (camelCase)
    model_response = {
        "content": {
            "parts": [{"functionCall": {"name": "get_weather", "args": {"location": "SF"}}}],
            "role": "model",
        },
    }

    call_type = _determine_llm_call_type(llm_request, model_response)
    assert call_type == "tool_selection", "Should be tool_selection when LLM calls a tool"


def test_determine_llm_call_type_tool_selection_snake_case():
    """Test that _determine_llm_call_type handles snake_case function_call."""
    from braintrust_adk import _determine_llm_call_type

    llm_request = {
        "config": {"tools": [{"function_declarations": [{"name": "search"}]}]},
        "contents": [{"parts": [{"text": "Search for pizza"}], "role": "user"}],
    }

    # Response with function call (snake_case)
    model_response = {
        "content": {
            "parts": [{"function_call": {"name": "search", "args": {"query": "pizza"}}}],
            "role": "model",
        },
    }

    call_type = _determine_llm_call_type(llm_request, model_response)
    assert call_type == "tool_selection", "Should be tool_selection for snake_case function_call"


def test_determine_llm_call_type_response_generation():
    """Test that _determine_llm_call_type returns 'response_generation' after tool execution."""
    from braintrust_adk import _determine_llm_call_type

    # Request with function_response in history
    llm_request = {
        "config": {"tools": [{"function_declarations": [{"name": "get_weather"}]}]},
        "contents": [
            {"parts": [{"text": "What's the weather?"}], "role": "user"},
            {"parts": [{"functionCall": {"name": "get_weather", "args": {}}}], "role": "model"},
            {
                "parts": [{"function_response": {"name": "get_weather", "response": {"temp": "72F"}}}],
                "role": "user",
            },
        ],
    }

    # Response after tool execution
    model_response = {
        "content": {"parts": [{"text": "It's 72 degrees"}], "role": "model"},
    }

    call_type = _determine_llm_call_type(llm_request, model_response)
    assert call_type == "response_generation", "Should be response_generation after tool execution"


def test_determine_llm_call_type_no_tools():
    """Test that _determine_llm_call_type returns 'direct_response' when no tools configured."""
    from braintrust_adk import _determine_llm_call_type

    llm_request = {
        "config": {},
        "contents": [{"parts": [{"text": "Hello"}], "role": "user"}],
    }

    model_response = {
        "content": {"parts": [{"text": "Hi there"}], "role": "model"},
    }

    call_type = _determine_llm_call_type(llm_request, model_response)
    assert call_type == "direct_response", "Should be direct_response when no tools configured"


def test_determine_llm_call_type_no_response():
    """Test that _determine_llm_call_type handles missing model_response gracefully."""
    from braintrust_adk import _determine_llm_call_type

    llm_request = {
        "config": {
            "tools": [{"function_declarations": [{"name": "tool1"}]}]
        },
        "contents": [{"parts": [{"text": "Test"}], "role": "user"}],
    }

    # No model_response provided
    call_type = _determine_llm_call_type(llm_request, None)
    assert call_type == "direct_response", "Should default to direct_response when no response available"
