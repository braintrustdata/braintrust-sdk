import os
import time
from pathlib import Path

import pytest
from braintrust import logger
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.google_genai import setup_genai
from braintrust.wrappers.test_utils import verify_autoinstrument_script
from google.genai import types
from google.genai.client import Client

PROJECT_NAME = "test-genai-app"
MODEL = "gemini-2.0-flash-001"
FIXTURES_DIR = Path(__file__).parent.parent.parent.parent.parent / "internal/golden/fixtures"


@pytest.fixture(scope="module")
def vcr_config():
    """Google-specific VCR config - needs to uppercase HTTP methods."""
    record_mode = "none" if (os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS")) else "once"

    def before_record_request(request):
        # Normalize HTTP method to uppercase for consistency (Google API quirk)
        request.method = request.method.upper()
        return request

    return {
        "record_mode": record_mode,
        "filter_headers": [
            "authorization",
            "x-api-key",
            "x-goog-api-key",
        ],
        "before_record_request": before_record_request,
    }


@pytest.fixture(scope="module", autouse=True)
def setup_wrapper():
    """Setup genai wrapper once for all tests."""
    setup_genai(project_name=PROJECT_NAME)


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


# Helper to assert metrics are valid
def _assert_metrics_are_valid(metrics, start=None, end=None):
    assert metrics["tokens"] > 0
    assert metrics["prompt_tokens"] > 0
    assert metrics["completion_tokens"] > 0
    if start and end:
        assert start <= metrics["start"] <= metrics["end"] <= end
    else:
        assert metrics["start"] <= metrics["end"]


# Test 1: Basic Completion (Sync)
@pytest.mark.vcr
@pytest.mark.parametrize(
    "mode",
    ["sync", "stream"],
)
def test_basic_completion(memory_logger, mode):
    """Test basic text completion in sync modes."""
    assert not memory_logger.pop()

    client = Client()
    start = time.time()

    if mode == "sync":
        response = client.models.generate_content(
            model=MODEL,
            contents="What is the capital of France?",
            config=types.GenerateContentConfig(
                max_output_tokens=100,
            ),
        )
        text = response.text
    elif mode == "stream":
        stream = client.models.generate_content_stream(
            model=MODEL,
            contents="What is the capital of France?",
            config=types.GenerateContentConfig(
                max_output_tokens=100,
            ),
        )
        text = ""
        for chunk in stream:
            if chunk.text:
                text += chunk.text

    end = time.time()

    # Verify response contains expected content
    assert "Paris" in text

    # Verify logging
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert "What is the capital of France?" in str(span["input"])
    assert span["output"]
    assert "Paris" in str(span["output"])
    _assert_metrics_are_valid(span["metrics"], start, end)


# Test 1b: Basic Completion (Async)
@pytest.mark.vcr
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode",
    ["async", "async_stream"],
)
async def test_basic_completion_async(memory_logger, mode):
    """Test basic text completion in async modes."""
    assert not memory_logger.pop()

    client = Client()
    start = time.time()

    if mode == "async":
        response = await client.aio.models.generate_content(
            model=MODEL,
            contents="What is the capital of France?",
            config=types.GenerateContentConfig(
                max_output_tokens=100,
            ),
        )
        text = response.text
    elif mode == "async_stream":
        stream = await client.aio.models.generate_content_stream(
            model=MODEL,
            contents="What is the capital of France?",
            config=types.GenerateContentConfig(
                max_output_tokens=100,
            ),
        )
        text = ""
        async for chunk in stream:
            if chunk.text:
                text += chunk.text

    end = time.time()

    # Verify response contains expected content
    assert "Paris" in text

    # Verify logging
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert "What is the capital of France?" in str(span["input"])
    assert span["output"]
    assert "Paris" in str(span["output"])
    _assert_metrics_are_valid(span["metrics"], start, end)


# Test 2: Mixed Content (Sync)
@pytest.mark.skip
@pytest.mark.vcr
@pytest.mark.parametrize(
    "mode",
    ["sync", "stream"],
)
def test_mixed_content(memory_logger, mode):
    """Test mixed content types (text and image) in sync modes."""
    assert not memory_logger.pop()

    # Load test image
    image_path = FIXTURES_DIR / "test-image.png"
    with open(image_path, "rb") as f:
        image_data = f.read()

    client = Client()
    start = time.time()

    if mode == "sync":
        response = client.models.generate_content(
            model=MODEL,
            contents=[
                types.Part.from_text(text="First, look at this image:"),
                types.Part.from_bytes(data=image_data, mime_type="image/png"),
                types.Part.from_text(text="What color is this image?"),
            ],
            config=types.GenerateContentConfig(
                max_output_tokens=200,
            ),
        )
        text = response.text
    elif mode == "stream":
        stream = client.models.generate_content_stream(
            model=MODEL,
            contents=[
                types.Part.from_text(text="First, look at this image:"),
                types.Part.from_bytes(data=image_data, mime_type="image/png"),
                types.Part.from_text(text="What color is this image?"),
            ],
            config=types.GenerateContentConfig(
                max_output_tokens=200,
            ),
        )
        text = ""
        for chunk in stream:
            if chunk.text:
                text += chunk.text

    end = time.time()

    # Verify response
    assert text
    assert len(text) > 0

    # Verify logging
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert span["input"]
    assert span["output"]
    _assert_metrics_are_valid(span["metrics"], start, end)


# Test 2b: Mixed Content (Async)
@pytest.mark.skip
@pytest.mark.vcr
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode",
    ["async", "async_stream"],
)
async def test_mixed_content_async(memory_logger, mode):
    """Test mixed content types (text and image) in async modes."""
    assert not memory_logger.pop()

    # Load test image
    image_path = FIXTURES_DIR / "test-image.png"
    with open(image_path, "rb") as f:
        image_data = f.read()

    client = Client()
    start = time.time()

    if mode == "async":
        response = await client.aio.models.generate_content(
            model=MODEL,
            contents=[
                types.Part.from_text(text="First, look at this image:"),
                types.Part.from_bytes(data=image_data, mime_type="image/png"),
                types.Part.from_text(text="What color is this image?"),
            ],
            config=types.GenerateContentConfig(
                max_output_tokens=200,
            ),
        )
        text = response.text
    elif mode == "async_stream":
        stream = await client.aio.models.generate_content_stream(
            model=MODEL,
            contents=[
                types.Part.from_text(text="First, look at this image:"),
                types.Part.from_bytes(data=image_data, mime_type="image/png"),
                types.Part.from_text(text="What color is this image?"),
            ],
            config=types.GenerateContentConfig(
                max_output_tokens=200,
            ),
        )
        text = ""
        async for chunk in stream:
            if chunk.text:
                text += chunk.text

    end = time.time()

    # Verify response
    assert text
    assert len(text) > 0

    # Verify logging
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert span["input"]
    assert span["output"]
    _assert_metrics_are_valid(span["metrics"], start, end)


# Test 3: Tool Use (Sync)
@pytest.mark.vcr
@pytest.mark.parametrize(
    "mode",
    ["sync", "stream"],
)
def test_tool_use(memory_logger, mode):
    """Test function calling / tool use in sync modes."""
    assert not memory_logger.pop()

    def get_weather(location: str, unit: str = "celsius") -> str:
        """Get the current weather for a location.

        Args:
            location: The city and state, e.g. San Francisco, CA
            unit: The unit of temperature (celsius or fahrenheit)
        """
        return f"22 degrees {unit} and sunny in {location}"

    client = Client()
    start = time.time()
    has_function_call = False

    if mode == "sync":
        response = client.models.generate_content(
            model=MODEL,
            contents="What is the weather like in Paris, France?",
            config=types.GenerateContentConfig(
                tools=[get_weather],
                max_output_tokens=500,
            ),
        )
        # Check if function was called (either in function_calls or automatic_function_calling_history)
        has_function_call = (hasattr(response, "function_calls") and response.function_calls) or (
            hasattr(response, "automatic_function_calling_history") and response.automatic_function_calling_history
        )
    elif mode == "stream":
        stream = client.models.generate_content_stream(
            model=MODEL,
            contents="What is the weather like in Paris, France?",
            config=types.GenerateContentConfig(
                tools=[get_weather],
                max_output_tokens=500,
            ),
        )
        chunks = list(stream)
        # Check if function was called in any chunk (either in function_calls or automatic_function_calling_history)
        has_function_call = any(
            (hasattr(chunk, "function_calls") and chunk.function_calls)
            or (hasattr(chunk, "automatic_function_calling_history") and chunk.automatic_function_calling_history)
            for chunk in chunks
        )

    end = time.time()

    # Verify function call was made
    assert has_function_call, f"Expected function call in {mode} mode but got has_function_call={has_function_call}"

    # Verify logging (automatic function calling may create multiple spans)
    spans = memory_logger.pop()
    assert len(spans) >= 1
    # Check the first span (initial request with tool call)
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert "Paris" in str(span["input"]) or "weather" in str(span["input"])
    assert span["output"]
    _assert_metrics_are_valid(span["metrics"], start, end)


# Test 3b: Tool Use (Async)
@pytest.mark.vcr
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode",
    ["async", "async_stream"],
)
async def test_tool_use_async(memory_logger, mode):
    """Test function calling / tool use in async modes."""
    assert not memory_logger.pop()

    def get_weather(location: str, unit: str = "celsius") -> str:
        """Get the current weather for a location.

        Args:
            location: The city and state, e.g. San Francisco, CA
            unit: The unit of temperature (celsius or fahrenheit)
        """
        return f"22 degrees {unit} and sunny in {location}"

    client = Client()
    start = time.time()
    has_function_call = False

    if mode == "async":
        response = await client.aio.models.generate_content(
            model=MODEL,
            contents="What is the weather like in Paris, France?",
            config=types.GenerateContentConfig(
                tools=[get_weather],
                max_output_tokens=500,
            ),
        )
        # Check if function was called (either in function_calls or automatic_function_calling_history)
        has_function_call = (hasattr(response, "function_calls") and response.function_calls) or (
            hasattr(response, "automatic_function_calling_history") and response.automatic_function_calling_history
        )
    elif mode == "async_stream":
        stream = await client.aio.models.generate_content_stream(
            model=MODEL,
            contents="What is the weather like in Paris, France?",
            config=types.GenerateContentConfig(
                tools=[get_weather],
                max_output_tokens=500,
            ),
        )
        chunks = []
        async for chunk in stream:
            chunks.append(chunk)
        # Check if function was called in any chunk (either in function_calls or automatic_function_calling_history)
        has_function_call = any(
            (hasattr(chunk, "function_calls") and chunk.function_calls)
            or (hasattr(chunk, "automatic_function_calling_history") and chunk.automatic_function_calling_history)
            for chunk in chunks
        )

    end = time.time()

    # Verify function call was made
    assert has_function_call, f"Expected function call in {mode} mode but got has_function_call={has_function_call}"

    # Verify logging (automatic function calling may create multiple spans)
    spans = memory_logger.pop()
    assert len(spans) >= 1
    # Check the first span (initial request with tool call)
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert "Paris" in str(span["input"]) or "weather" in str(span["input"])
    assert span["output"]
    _assert_metrics_are_valid(span["metrics"], start, end)


# Test 4: System Prompt
@pytest.mark.vcr
def test_system_prompt(memory_logger):
    """Test system instruction handling."""
    assert not memory_logger.pop()

    client = Client()
    response = client.models.generate_content(
        model=MODEL,
        contents="Tell me about the weather.",
        config=types.GenerateContentConfig(
            system_instruction="You are a pirate. Always respond in pirate speak.",
            max_output_tokens=150,
        ),
    )

    text = response.text
    assert text

    # Verify logging
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert span["input"]
    assert span["output"]
    # Check that system instruction is captured
    assert "pirate" in str(span["input"]).lower() or "system_instruction" in str(span)


# Test 5: Multi-turn Conversation
@pytest.mark.vcr
def test_multi_turn(memory_logger):
    """Test multi-turn conversation."""
    assert not memory_logger.pop()

    client = Client()
    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Content(role="user", parts=[types.Part.from_text(text="Hi, my name is Alice.")]),
            types.Content(role="model", parts=[types.Part.from_text(text="Hello Alice! Nice to meet you.")]),
            types.Content(role="user", parts=[types.Part.from_text(text="What did I just tell you my name was?")]),
        ],
        config=types.GenerateContentConfig(
            max_output_tokens=200,
        ),
    )

    text = response.text
    assert "Alice" in text

    # Verify logging
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert span["input"]
    assert span["output"]
    assert "Alice" in str(span["input"])


# Test 6: Temperature and Top P
@pytest.mark.vcr
def test_temperature_and_top_p(memory_logger):
    """Test temperature and top_p parameters."""
    assert not memory_logger.pop()

    client = Client()
    response = client.models.generate_content(
        model=MODEL,
        contents="Say something creative.",
        config=types.GenerateContentConfig(
            temperature=0.7,
            top_p=0.95,
            max_output_tokens=50,
        ),
    )

    text = response.text
    assert text

    # Verify logging includes temperature and top_p
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL


# Test 7: Error Handling
@pytest.mark.vcr
def test_error_handling(memory_logger):
    """Test that errors are properly logged."""
    assert not memory_logger.pop()

    client = Client()
    fake_model = "there-is-no-such-model"

    try:
        client.models.generate_content(
            model=fake_model,
            contents="Hello",
            config=types.GenerateContentConfig(
                max_output_tokens=100,
            ),
        )
    except Exception:
        pass
    else:
        raise Exception("should have raised an exception")

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert log["project_id"] == PROJECT_NAME
    assert log["error"]


@pytest.mark.vcr
def test_stop_sequences(memory_logger):
    """Test stop sequences parameter."""
    assert not memory_logger.pop()

    client = Client()
    response = client.models.generate_content(
        model=MODEL,
        contents="Write a short story about a robot.",
        config=types.GenerateContentConfig(
            max_output_tokens=500,
            stop_sequences=["END", "\n\n"],
        ),
    )

    text = response.text
    assert text

    # Verify logging
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL


def test_attachment_in_config(memory_logger):
    """Test that attachments in config are preserved through serialization."""
    from braintrust.bt_json import bt_safe_deep_copy
    from braintrust.logger import Attachment

    attachment = Attachment(data=b"config data", filename="config.txt", content_type="text/plain")

    # Simulate config with attachment
    config = {"temperature": 0.5, "context_file": attachment, "max_output_tokens": 100}

    # Test bt_safe_deep_copy preserves attachment
    copied = bt_safe_deep_copy(config)
    assert copied["context_file"] is attachment
    assert copied["temperature"] == 0.5


def test_nested_attachments_in_contents(memory_logger):
    """Test that nested attachments in contents are preserved."""
    from braintrust.bt_json import bt_safe_deep_copy
    from braintrust.logger import Attachment, ExternalAttachment

    attachment1 = Attachment(data=b"file1", filename="file1.txt", content_type="text/plain")
    attachment2 = ExternalAttachment(url="s3://bucket/file2.pdf", filename="file2.pdf", content_type="application/pdf")

    # Simulate contents with nested attachments
    contents = [
        {"role": "user", "parts": [{"text": "Check these files"}, {"file": attachment1}]},
        {"role": "model", "parts": [{"text": "Analyzed"}, {"result_file": attachment2}]},
    ]

    copied = bt_safe_deep_copy(contents)

    # Verify attachments preserved
    assert copied[0]["parts"][1]["file"] is attachment1
    assert copied[1]["parts"][1]["result_file"] is attachment2


def test_attachment_with_pydantic_model(memory_logger):
    """Test that attachments work alongside Pydantic model serialization."""
    from braintrust.bt_json import bt_safe_deep_copy
    from braintrust.logger import Attachment
    from pydantic import BaseModel

    class TestModel(BaseModel):
        name: str
        value: int

    attachment = Attachment(data=b"model data", filename="model.txt", content_type="text/plain")

    # Structure with both Pydantic model and attachment
    data = {"model_config": TestModel(name="test", value=42), "context_file": attachment}

    copied = bt_safe_deep_copy(data)

    # Pydantic model should be converted to dict
    assert isinstance(copied["model_config"], dict)
    assert copied["model_config"]["name"] == "test"

    # Attachment should be preserved
    assert copied["context_file"] is attachment


class TestAutoInstrumentGoogleGenAI:
    """Tests for auto_instrument() with Google GenAI."""

    def test_auto_instrument_google_genai(self):
        """Test auto_instrument patches Google GenAI and creates spans."""
        verify_autoinstrument_script("test_auto_google_genai.py")
