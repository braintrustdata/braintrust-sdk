"""
Tests for Braintrust Pydantic AI integration.

Tests real use cases with VCR cassettes to ensure proper tracing.
"""
import time

import pytest
from braintrust import logger, setup_pydantic_ai
from braintrust.span_types import SpanTypeAttribute
from braintrust.test_helpers import init_test_logger
from pydantic import BaseModel
from pydantic_ai import Agent, ModelSettings
from pydantic_ai.direct import model_request, model_request_stream, model_request_stream_sync, model_request_sync
from pydantic_ai.messages import ModelRequest, UserPromptPart

PROJECT_NAME = "test-pydantic-ai-integration"
MODEL = "openai:gpt-4o-mini"  # Use cheaper model for tests
TEST_PROMPT = "What is 2+2? Answer with just the number."


@pytest.fixture(scope="module")
def vcr_config():
    return {
        "filter_headers": [
            "authorization",
            "openai-organization",
            "x-api-key",
        ]
    }


@pytest.fixture(autouse=True)
def setup_integration():
    """Setup Pydantic AI integration before each test."""
    setup_pydantic_ai(project_name=PROJECT_NAME)


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


def _assert_metrics_are_valid(metrics, start, end):
    """Assert that metrics contain expected fields and values."""
    assert "start" in metrics
    assert "end" in metrics
    assert "duration" in metrics
    assert start <= metrics["start"] <= metrics["end"] <= end
    assert metrics["duration"] > 0

    # Token metrics (if present)
    if "tokens" in metrics:
        assert metrics["tokens"] > 0
    if "prompt_tokens" in metrics:
        assert metrics["prompt_tokens"] > 0
    if "completion_tokens" in metrics:
        assert metrics["completion_tokens"] > 0


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_run_async(memory_logger):
    """Test Agent.run() async method."""
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=50))

    start = time.time()
    result = await agent.run(TEST_PROMPT)
    end = time.time()

    # Verify the result
    assert result.output
    assert "4" in str(result.output)

    # Check spans - should now have parent agent_run + nested chat span
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run and chat spans
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run span not found"
    assert chat_span is not None, "chat span not found"

    # Check agent span
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    assert agent_span["metadata"]["provider"] == "openai"
    assert TEST_PROMPT in str(agent_span["input"])
    assert "4" in str(agent_span["output"])
    _assert_metrics_are_valid(agent_span["metrics"], start, end)

    # Check chat span is nested under agent span
    assert chat_span["span_parents"] == [agent_span["id"]], "chat span should be nested under agent_run"
    assert chat_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert "gpt-4o-mini" in chat_span["span_attributes"]["name"]
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)

    # Agent spans should have token metrics
    assert "prompt_tokens" in agent_span["metrics"]
    assert "completion_tokens" in agent_span["metrics"]
    assert agent_span["metrics"]["prompt_tokens"] > 0
    assert agent_span["metrics"]["completion_tokens"] > 0


@pytest.mark.vcr
def test_agent_run_sync(memory_logger):
    """Test Agent.run_sync() synchronous method."""
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=50))

    start = time.time()
    result = agent.run_sync(TEST_PROMPT)
    end = time.time()

    # Verify the result
    assert result.output
    assert "4" in str(result.output)

    # Check spans - should now have parent agent_run_sync + nested chat span
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run_sync + chat), got {len(spans)}"

    # Find agent_run_sync and chat spans
    agent_span = next((s for s in spans if "agent_run_sync" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run_sync span not found"
    assert chat_span is not None, "chat span not found"

    # Check agent span
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    assert agent_span["metadata"]["provider"] == "openai"
    assert TEST_PROMPT in str(agent_span["input"])
    assert "4" in str(agent_span["output"])
    _assert_metrics_are_valid(agent_span["metrics"], start, end)

    # Check chat span is nested under agent span
    assert chat_span["span_parents"] == [agent_span["id"]], "chat span should be nested under agent_run_sync"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)

    # Agent spans should have token metrics
    assert "prompt_tokens" in agent_span["metrics"]
    assert "completion_tokens" in agent_span["metrics"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_run_stream(memory_logger):
    """Test Agent.run_stream() streaming method."""
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=100))

    start = time.time()
    full_text = ""
    async with agent.run_stream("Count from 1 to 5") as result:
        async for text in result.stream_text(delta=True):
            full_text += text
    end = time.time()

    # Verify we got streaming content
    assert full_text
    assert any(str(i) in full_text for i in range(1, 6))

    # Check spans - should now have parent agent_run_stream + nested chat span
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run_stream + chat), got {len(spans)}"

    # Find agent_run_stream and chat spans
    agent_span = next((s for s in spans if "agent_run_stream" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run_stream span not found"
    assert chat_span is not None, "chat span not found"

    # Check agent span
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    assert "Count from 1 to 5" in str(agent_span["input"])
    _assert_metrics_are_valid(agent_span["metrics"], start, end)

    # Check chat span is nested under agent span
    assert chat_span["span_parents"] == [agent_span["id"]], "chat span should be nested under agent_run_stream"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)

    # Agent spans should have token metrics
    assert "prompt_tokens" in agent_span["metrics"]
    assert "completion_tokens" in agent_span["metrics"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_tools(memory_logger):
    """Test Agent with tool calls."""
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=200))

    @agent.tool_plain
    def get_weather(city: str) -> str:
        """Get weather for a city.

        Args:
            city: The city name
        """
        return f"It's sunny in {city}"

    start = time.time()
    result = await agent.run("What's the weather in Paris?")
    end = time.time()

    # Verify tool was used
    assert result.output
    assert "Paris" in str(result.output) or "sunny" in str(result.output)

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) >= 1  # At least the agent span, possibly more

    # Find the agent span
    agent_span = next(s for s in spans if "agent_run" in s["span_attributes"]["name"])
    assert agent_span
    assert "weather" in str(agent_span["input"]).lower() or "paris" in str(agent_span["input"]).lower()
    _assert_metrics_are_valid(agent_span["metrics"], start, end)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_model_request(memory_logger):
    """Test direct API model_request()."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content=TEST_PROMPT)])]

    start = time.time()
    response = await model_request(model=MODEL, messages=messages)
    end = time.time()

    # Verify response
    assert response.parts
    assert "4" in str(response.parts[0].content)

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 1

    span = spans[0]
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert span["span_attributes"]["name"] == "model_request"
    assert span["metadata"]["model"] == "gpt-4o-mini"
    assert span["metadata"]["provider"] == "openai"
    assert TEST_PROMPT in str(span["input"])
    assert "4" in str(span["output"])
    _assert_metrics_are_valid(span["metrics"], start, end)


@pytest.mark.vcr
def test_direct_model_request_sync(memory_logger):
    """Test direct API model_request_sync()."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content=TEST_PROMPT)])]

    start = time.time()
    response = model_request_sync(model=MODEL, messages=messages)
    end = time.time()

    # Verify response
    assert response.parts
    assert "4" in str(response.parts[0].content)

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 1

    span = spans[0]
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert span["span_attributes"]["name"] == "model_request_sync"
    assert span["metadata"]["model"] == "gpt-4o-mini"
    assert TEST_PROMPT in str(span["input"])
    _assert_metrics_are_valid(span["metrics"], start, end)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_model_request_with_settings(memory_logger):
    """Test that model_settings appears in input for direct API calls."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Say hello")])]
    custom_settings = ModelSettings(max_tokens=50, temperature=0.7)

    start = time.time()
    result = await model_request(model=MODEL, messages=messages, model_settings=custom_settings)
    end = time.time()

    # Verify result
    assert result.parts

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 1

    span = spans[0]
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert span["span_attributes"]["name"] == "model_request"

    # Verify model_settings is in input (NOT metadata)
    assert "model_settings" in span["input"], "model_settings should be in input"
    settings = span["input"]["model_settings"]
    assert settings["max_tokens"] == 50
    assert settings["temperature"] == 0.7

    # Verify model_settings is NOT in metadata
    assert "model_settings" not in span["metadata"], "model_settings should NOT be in metadata"

    # Verify metadata still has model and provider
    assert span["metadata"]["model"] == "gpt-4o-mini"
    assert span["metadata"]["provider"] == "openai"

    _assert_metrics_are_valid(span["metrics"], start, end)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_model_request_stream(memory_logger):
    """Test direct API model_request_stream()."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Count from 1 to 3")])]

    start = time.time()
    chunk_count = 0
    async with model_request_stream(model=MODEL, messages=messages) as stream:
        async for chunk in stream:
            chunk_count += 1
    end = time.time()

    # Verify we got chunks
    assert chunk_count > 0

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 1

    span = spans[0]
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert span["span_attributes"]["name"] == "model_request_stream"
    assert span["metadata"]["model"] == "gpt-4o-mini"
    _assert_metrics_are_valid(span["metrics"], start, end)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_structured_output(memory_logger):
    """Test Agent with structured output (Pydantic model)."""
    assert not memory_logger.pop()

    class MathAnswer(BaseModel):
        answer: int
        explanation: str

    agent = Agent(
        MODEL,
        result_type=MathAnswer,
        model_settings=ModelSettings(max_tokens=200)
    )

    start = time.time()
    result = await agent.run("What is 10 + 15?")
    end = time.time()

    # Verify structured output
    assert isinstance(result.output, MathAnswer)
    assert result.output.answer == 25
    assert result.output.explanation

    # Check spans - should now have parent agent_run + nested chat span
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run and chat spans
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"] and "chat" not in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run span not found"
    assert chat_span is not None, "chat span not found"

    # Check agent span
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    assert agent_span["metadata"]["provider"] == "openai"
    assert "10 + 15" in str(agent_span["input"])
    assert "25" in str(agent_span["output"])
    _assert_metrics_are_valid(agent_span["metrics"], start, end)

    # Check chat span is nested
    assert chat_span["span_parents"] == [agent_span["id"]], "chat span should be nested under agent_run"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)

    # Agent spans should have token metrics
    assert "prompt_tokens" in agent_span["metrics"]
    assert "completion_tokens" in agent_span["metrics"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_model_settings_in_metadata(memory_logger):
    """Test that model_settings from agent config appears in metadata, not input."""
    assert not memory_logger.pop()

    custom_settings = ModelSettings(max_tokens=100, temperature=0.5)
    agent = Agent(MODEL, model_settings=custom_settings)

    start = time.time()
    result = await agent.run("Say hello")
    end = time.time()

    assert result.output

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run and chat spans
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"] and "chat" not in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run span not found"
    assert chat_span is not None, "chat span not found"

    # Verify model_settings is in agent METADATA (not input, since it's agent config)
    assert "model_settings" in agent_span["metadata"], "model_settings should be in agent_run metadata"
    agent_settings = agent_span["metadata"]["model_settings"]
    assert agent_settings["max_tokens"] == 100
    assert agent_settings["temperature"] == 0.5

    # Verify model_settings is NOT in agent input (it wasn't passed to run())
    assert "model_settings" not in agent_span["input"], "model_settings should NOT be in agent_run input when not passed to run()"

    # Verify model_settings is in chat input (passed to the model)
    assert "model_settings" in chat_span["input"], "model_settings should be in chat span input"
    chat_settings = chat_span["input"]["model_settings"]
    assert chat_settings["max_tokens"] == 100
    assert chat_settings["temperature"] == 0.5

    # Verify model_settings is NOT in chat metadata (it's in input)
    assert "model_settings" not in chat_span["metadata"], "model_settings should NOT be in chat span metadata"

    # Verify other metadata is present
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_model_settings_override_in_input(memory_logger):
    """Test that model_settings passed to run() appears in input, not metadata."""
    assert not memory_logger.pop()

    # Agent has default settings
    default_settings = ModelSettings(max_tokens=50)
    agent = Agent(MODEL, model_settings=default_settings)

    # Override with different settings in run() call
    override_settings = ModelSettings(max_tokens=200, temperature=0.9)

    start = time.time()
    result = await agent.run("Tell me a story", model_settings=override_settings)
    end = time.time()

    assert result.output

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run span
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"] and "chat" not in s["span_attributes"]["name"]), None)
    assert agent_span is not None, "agent_run span not found"

    # Verify override settings are in agent INPUT (because they were passed to run())
    assert "model_settings" in agent_span["input"], "model_settings should be in agent_run input when passed to run()"
    input_settings = agent_span["input"]["model_settings"]
    assert input_settings["max_tokens"] == 200, "Should use override settings from run() call"
    assert input_settings["temperature"] == 0.9

    # Verify agent default settings are NOT in metadata (when overridden in input, we don't duplicate in metadata)
    assert "model_settings" not in agent_span["metadata"], "model_settings should NOT be in metadata when explicitly passed to run()"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_system_prompt_in_metadata(memory_logger):
    """Test that system_prompt from agent config appears in metadata."""
    assert not memory_logger.pop()

    system_prompt = "You are a helpful AI assistant who speaks like a pirate."
    agent = Agent(MODEL, system_prompt=system_prompt, model_settings=ModelSettings(max_tokens=100))

    start = time.time()
    result = await agent.run("What is the weather?")
    end = time.time()

    assert result.output

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run span
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"] and "chat" not in s["span_attributes"]["name"]), None)
    assert agent_span is not None, "agent_run span not found"

    # Verify system_prompt is in metadata (not input)
    assert "system_prompt" in agent_span["metadata"], "system_prompt should be in agent_run metadata"
    assert agent_span["metadata"]["system_prompt"] == system_prompt, "system_prompt should be the actual string, not a method reference"

    # Verify system_prompt is NOT in input (it wasn't passed to run())
    assert "system_prompt" not in agent_span["input"], "system_prompt should NOT be in agent_run input when not passed to run()"

    # Verify other metadata is present
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    assert agent_span["metadata"]["provider"] == "openai"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_message_history(memory_logger):
    """Test Agent with conversation history."""
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=100))

    # First message
    result1 = await agent.run("My name is Alice")
    assert result1.output
    memory_logger.pop()  # Clear first span

    # Second message with history
    start = time.time()
    result2 = await agent.run(
        "What is my name?",
        message_history=result1.all_messages()
    )
    end = time.time()

    # Verify it remembers
    assert "Alice" in str(result2.output)

    # Check spans - should now have parent agent_run + nested chat span
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run and chat spans
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"] and "chat" not in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run span not found"
    assert "message_history" in str(agent_span["input"])
    assert "Alice" in str(span["output"])
    _assert_metrics_are_valid(span["metrics"], start, end)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_custom_settings(memory_logger):
    """Test Agent with custom model settings."""
    assert not memory_logger.pop()

    agent = Agent(MODEL)

    start = time.time()
    result = await agent.run(
        "Say hello",
        model_settings=ModelSettings(
            max_tokens=20,
            temperature=0.5,
            top_p=0.9
        )
    )
    end = time.time()

    assert result.output

    # Check spans - should now have parent agent_run + nested chat span
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run span
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"] and "chat" not in s["span_attributes"]["name"]), None)
    assert agent_span is not None, "agent_run span not found"

    # Model settings should be in metadata
    assert "model_settings" in agent_span["metadata"]
    settings = agent_span["metadata"]["model_settings"]
    assert settings["max_tokens"] == 20
    assert settings["temperature"] == 0.5
    assert settings["top_p"] == 0.9
    _assert_metrics_are_valid(agent_span["metrics"], start, end)


@pytest.mark.vcr
def test_agent_run_stream_sync(memory_logger):
    """Test Agent.run_stream_sync() synchronous streaming method."""
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=100))

    start = time.time()
    full_text = ""
    with agent.run_stream_sync("Count from 1 to 3") as result:
        for text in result.stream_text(delta=True):
            full_text += text
    end = time.time()

    # Verify we got streaming content
    assert full_text
    assert any(str(i) in full_text for i in range(1, 4))

    # Check spans - should now have parent agent_run_stream_sync + nested chat span
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run_stream_sync + chat), got {len(spans)}"

    # Find agent_run_stream_sync and chat spans
    agent_span = next((s for s in spans if "agent_run_stream_sync" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run_stream_sync span not found"
    assert chat_span is not None, "chat span not found"

    # Check agent span
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    assert "Count from 1 to 3" in str(agent_span["input"])
    _assert_metrics_are_valid(agent_span["metrics"], start, end)

    # Check chat span is nested
    assert chat_span["span_parents"] == [agent_span["id"]], "chat span should be nested under agent_run_stream_sync"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)

    # Agent spans should have token metrics
    assert "prompt_tokens" in agent_span["metrics"]
    assert "completion_tokens" in agent_span["metrics"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_run_stream_events(memory_logger):
    """Test Agent.run_stream_events() event streaming method."""
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=100))

    start = time.time()
    event_count = 0
    final_result = None
    async for event in agent.run_stream_events("What is 5+5?"):
        event_count += 1
        # Check if this is the final result event
        if hasattr(event, "output"):
            final_result = event
    end = time.time()

    # Verify we got events
    assert event_count > 0
    assert final_result is not None
    assert "10" in str(final_result.output)

    # Check spans - should now have parent agent_run_stream_events + nested chat span
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run_stream_events + chat), got {len(spans)}"

    # Find agent_run_stream_events and chat spans
    agent_span = next((s for s in spans if "agent_run_stream_events" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run_stream_events span not found"
    assert chat_span is not None, "chat span not found"

    # Check agent span
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    assert "5+5" in str(agent_span["input"])
    assert "10" in str(agent_span["output"])
    assert agent_span["metrics"]["event_count"] == event_count
    _assert_metrics_are_valid(agent_span["metrics"], start, end)

    # Check chat span is nested
    assert chat_span["span_parents"] == [agent_span["id"]], "chat span should be nested under agent_run_stream_events"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)

    # Agent spans should have token metrics
    assert "prompt_tokens" in agent_span["metrics"]
    assert "completion_tokens" in agent_span["metrics"]


@pytest.mark.vcr
def test_direct_model_request_stream_sync(memory_logger):
    """Test direct API model_request_stream_sync()."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Count from 1 to 3")])]

    start = time.time()
    chunk_count = 0
    with model_request_stream_sync(model=MODEL, messages=messages) as stream:
        for chunk in stream:
            chunk_count += 1
    end = time.time()

    # Verify we got chunks
    assert chunk_count > 0

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 1

    span = spans[0]
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert span["span_attributes"]["name"] == "model_request_stream_sync"
    assert span["metadata"]["model"] == "gpt-4o-mini"
    _assert_metrics_are_valid(span["metrics"], start, end)
