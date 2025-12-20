"""
Tests for Braintrust Pydantic AI integration.

Tests real use cases with VCR cassettes to ensure proper tracing.
"""
import time

import pytest
from braintrust import logger, setup_pydantic_ai, traced
from braintrust.span_types import SpanTypeAttribute
from braintrust.test_helpers import init_test_logger

# Setup integration BEFORE importing pydantic_ai modules
PROJECT_NAME = "test-pydantic-ai-integration"
setup_pydantic_ai(project_name=PROJECT_NAME)

from pydantic import BaseModel
from pydantic_ai import Agent, ModelSettings
from pydantic_ai.direct import model_request, model_request_stream, model_request_stream_sync, model_request_sync
from pydantic_ai.messages import ModelRequest, UserPromptPart

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

    # Check chat span is nested under agent span (use span_id, not id which is the row ID)
    assert chat_span["span_parents"] == [agent_span["span_id"]], "chat span should be nested under agent_run"
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
    assert len(spans) >= 2, f"Expected at least 2 spans (agent_run_sync + chat), got {len(spans)}"

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

    # Check chat span is nested under agent span (use span_id, not id which is the row ID)
    assert chat_span["span_parents"] == [agent_span["span_id"]], "chat span should be nested under agent_run_sync"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)

    # Agent spans should have token metrics
    assert "prompt_tokens" in agent_span["metrics"]
    assert "completion_tokens" in agent_span["metrics"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_multiple_identical_sequential_streams(memory_logger):
    """Test multiple identical sequential streaming calls to ensure offsets don't accumulate.

    This test makes 3 identical streaming calls in sequence. If timing is captured correctly,
    each chat span's offset relative to its parent agent span should be roughly the same
    (typically < 100ms). If offsets are accumulating incorrectly, we'd see the second and
    third chat spans having much larger offsets than the first.
    """
    assert not memory_logger.pop()

    @traced
    async def run_multiple_identical_streams():
        # Make 3 identical streaming calls
        for i in range(3):
            agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=50))
            async with agent.run_stream("Count from 1 to 3.") as result:
                full_text = ""
                async for text in result.stream_text(delta=True):
                    full_text += text
            print(f"Completed stream {i+1}")

    await run_multiple_identical_streams()

    # Check spans
    spans = memory_logger.pop()

    # Find agent and chat spans
    agent_spans = [s for s in spans if "agent_run" in s["span_attributes"]["name"]]
    chat_spans = [s for s in spans if "chat" in s["span_attributes"]["name"]]

    assert len(agent_spans) >= 3, f"Expected at least 3 agent spans, got {len(agent_spans)}"
    assert len(chat_spans) >= 3, f"Expected at least 3 chat spans, got {len(chat_spans)}"

    # Sort by creation time
    agent_spans.sort(key=lambda s: s["created"])
    chat_spans.sort(key=lambda s: s["created"])

    # Calculate time-to-first-token for each pair
    time_to_first_tokens = []
    for i in range(3):
        agent_start = agent_spans[i]["metrics"]["start"]
        chat_start = chat_spans[i]["metrics"]["start"]
        ttft = chat_start - agent_start
        time_to_first_tokens.append(ttft)

        print(f"\n=== STREAM {i+1} ===")
        print(f"Agent span start: {agent_start}")
        print(f"Chat span start: {chat_start}")
        print(f"Time to first token: {ttft}s")
        print(f"Agent span ID: {agent_spans[i]['span_id']}")
        print(f"Chat span parents: {chat_spans[i]['span_parents']}")

    # CRITICAL: All three time-to-first-token values should be similar (within 0.5s of each other)
    # If they're accumulating, the second and third would be much larger
    min_ttft = min(time_to_first_tokens)
    max_ttft = max(time_to_first_tokens)
    ttft_spread = max_ttft - min_ttft

    print(f"\n=== TIME-TO-FIRST-TOKEN ANALYSIS ===")
    print(f"TTFT 1: {time_to_first_tokens[0]:.4f}s")
    print(f"TTFT 2: {time_to_first_tokens[1]:.4f}s")
    print(f"TTFT 3: {time_to_first_tokens[2]:.4f}s")
    print(f"Min: {min_ttft:.4f}s, Max: {max_ttft:.4f}s, Spread: {ttft_spread:.4f}s")

    # All should be small (< 3s)
    for i, ttft in enumerate(time_to_first_tokens):
        assert ttft < 3.0, f"Stream {i+1} time to first token too large: {ttft}s"

    # Spread should be small (< 0.5s) - this catches the accumulation bug
    assert ttft_spread < 0.5, f"Time-to-first-token spread too large: {ttft_spread}s - suggests timing is accumulating from previous calls"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_multiple_sequential_streams(memory_logger):
    """Test multiple sequential streaming calls to ensure offsets don't accumulate."""
    assert not memory_logger.pop()

    @traced
    async def run_multiple_streams():
        agent1 = Agent(MODEL, model_settings=ModelSettings(max_tokens=50))
        agent2 = Agent(MODEL, model_settings=ModelSettings(max_tokens=50))

        start = time.time()

        # First stream
        async with agent1.run_stream("Count from 1 to 3.") as result1:
            full_text1 = ""
            async for text in result1.stream_text(delta=True):
                full_text1 += text

        # Second stream
        async with agent2.run_stream("Count from 1 to 3.") as result2:
            full_text2 = ""
            async for text in result2.stream_text(delta=True):
                full_text2 += text

        return start

    start = await run_multiple_streams()
    end = time.time()

    # Check spans
    spans = memory_logger.pop()

    # Should have: 1 parent (run_multiple_streams) + 2 agent_run_stream spans + 2 chat spans = 5 total
    assert len(spans) >= 5, f"Expected at least 5 spans (1 parent + 2 agent_run_stream + 2 chat), got {len(spans)}"

    # Find agent and chat spans
    agent_spans = [s for s in spans if "agent_run" in s["span_attributes"]["name"]]
    chat_spans = [s for s in spans if "chat" in s["span_attributes"]["name"]]

    assert len(agent_spans) >= 2, f"Expected at least 2 agent spans, got {len(agent_spans)}"
    assert len(chat_spans) >= 2, f"Expected at least 2 chat spans, got {len(chat_spans)}"

    # Sort by creation time
    agent_spans.sort(key=lambda s: s["created"])
    chat_spans.sort(key=lambda s: s["created"])

    agent1_span = agent_spans[0]
    agent2_span = agent_spans[1]
    chat1_span = chat_spans[0]
    chat2_span = chat_spans[1]

    # Check timing for first pair
    agent1_start = agent1_span["metrics"]["start"]
    chat1_start = chat1_span["metrics"]["start"]
    time_to_first_token_1 = chat1_start - agent1_start

    # Check timing for second pair
    agent2_start = agent2_span["metrics"]["start"]
    chat2_start = chat2_span["metrics"]["start"]
    time_to_first_token_2 = chat2_start - agent2_start

    print(f"\n=== FIRST STREAM ===")
    print(f"Agent1 start: {agent1_start}")
    print(f"Chat1 start: {chat1_start}")
    print(f"Time to first token 1: {time_to_first_token_1}s")

    print(f"\n=== SECOND STREAM ===")
    print(f"Agent2 start: {agent2_start}")
    print(f"Chat2 start: {chat2_start}")
    print(f"Time to first token 2: {time_to_first_token_2}s")

    print(f"\n=== RELATIVE TIMING ===")
    print(f"Agent2 start - Agent1 start: {agent2_start - agent1_start}s")
    print(f"Chat2 start - Chat1 start: {chat2_start - chat1_start}s")

    # CRITICAL: Both time-to-first-token values should be small and similar
    assert time_to_first_token_1 < 3.0, f"First time to first token too large: {time_to_first_token_1}s"
    assert time_to_first_token_2 < 3.0, f"Second time to first token too large: {time_to_first_token_2}s - suggests start_time is being reused from first call"

    # Agent2 should start AFTER agent1 finishes (or near the end)
    agent1_end = agent1_span["metrics"]["end"]
    assert agent2_start >= agent1_end - 0.1, f"Agent2 started too early: {agent2_start} vs Agent1 end: {agent1_end}"


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
    assert chat_span["span_parents"] == [agent_span["span_id"]], "chat span should be nested under agent_run_stream"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)

    # CRITICAL: Check that the chat span's start time is close to agent span start
    # The offset/time-to-first-token should be small (typically < 2 seconds)
    agent_start = agent_span["metrics"]["start"]
    chat_start = chat_span["metrics"]["start"]
    time_to_first_token = chat_start - agent_start

    # Debug: Print full span data
    print(f"\n=== AGENT SPAN ===")
    print(f"ID: {agent_span['id']}")
    print(f"span_id: {agent_span['span_id']}")
    print(f"metrics: {agent_span['metrics']}")
    print(f"\n=== CHAT SPAN ===")
    print(f"ID: {chat_span['id']}")
    print(f"span_id: {chat_span['span_id']}")
    print(f"span_parents: {chat_span['span_parents']}")
    print(f"metrics: {chat_span['metrics']}")

    # Time to first token should be reasonable (< 3 seconds for API call initiation)
    assert time_to_first_token < 3.0, f"Time to first token too large: {time_to_first_token}s - suggests start_time is being reused incorrectly"

    # Both spans should have started during our test timeframe
    assert agent_start >= start, "Agent span started before test"
    assert chat_start >= start, "Chat span started before test"

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
    # Direct API calls may create 1 or 2 spans depending on model wrapping
    assert len(spans) >= 1

    # Find the direct API span
    direct_span = next((s for s in spans if s["span_attributes"]["name"] == "model_request"), None)
    assert direct_span is not None

    assert direct_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert direct_span["metadata"]["model"] == "gpt-4o-mini"
    assert direct_span["metadata"]["provider"] == "openai"
    assert TEST_PROMPT in str(direct_span["input"])
    assert "4" in str(direct_span["output"])
    _assert_metrics_are_valid(direct_span["metrics"], start, end)


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

    # Check spans - direct API creates 2 spans: one from direct wrapper, one from model class
    spans = memory_logger.pop()
    assert len(spans) == 2

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
    # Direct API calls may create 1 or 2 spans depending on model wrapping
    assert len(spans) >= 1

    # Find the direct API span
    direct_span = next((s for s in spans if s["span_attributes"]["name"] == "model_request"), None)
    assert direct_span is not None

    assert direct_span["span_attributes"]["type"] == SpanTypeAttribute.LLM

    # Verify model_settings is in input (NOT metadata)
    assert "model_settings" in direct_span["input"], "model_settings should be in input"
    settings = direct_span["input"]["model_settings"]
    assert settings["max_tokens"] == 50
    assert settings["temperature"] == 0.7

    # Verify model_settings is NOT in metadata
    assert "model_settings" not in direct_span["metadata"], "model_settings should NOT be in metadata"

    # Verify metadata still has model and provider
    assert direct_span["metadata"]["model"] == "gpt-4o-mini"
    assert direct_span["metadata"]["provider"] == "openai"

    _assert_metrics_are_valid(direct_span["metrics"], start, end)


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
    # Direct API calls may create 1 or 2 spans depending on model wrapping
    assert len(spans) >= 1

    # Find the direct API span
    direct_span = next((s for s in spans if s["span_attributes"]["name"] == "model_request_stream"), None)
    assert direct_span is not None

    assert direct_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert direct_span["metadata"]["model"] == "gpt-4o-mini"
    _assert_metrics_are_valid(direct_span["metrics"], start, end)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_model_request_stream_complete_output(memory_logger):
    """Test that direct API streaming captures all text including first chunk from PartStartEvent."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Say exactly: 1, 2, 3")])]

    collected_text = ""
    seen_delta = False
    async with model_request_stream(model=MODEL, messages=messages) as stream:
        async for chunk in stream:
            # Extract text, skipping final PartStartEvent after deltas
            if hasattr(chunk, 'part') and hasattr(chunk.part, 'content') and not seen_delta:
                # PartStartEvent has part.content with initial text
                collected_text += str(chunk.part.content)
            elif hasattr(chunk, 'delta') and chunk.delta:
                seen_delta = True
                # PartDeltaEvent has delta.content_delta
                if hasattr(chunk.delta, 'content_delta') and chunk.delta.content_delta:
                    collected_text += chunk.delta.content_delta

    # Verify we got complete output including "1"
    assert "1" in collected_text
    assert "2" in collected_text
    assert "3" in collected_text

    # Check spans were created
    spans = memory_logger.pop()
    assert len(spans) >= 1


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_api_streaming_call_3(memory_logger):
    """Test direct API streaming (call 3) - should output complete '1, 2, 3, 4, 5'."""
    assert not memory_logger.pop()

    IDENTICAL_PROMPT = "Count from 1 to 5."
    messages = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

    collected_text = ""
    async with model_request_stream(model="openai:gpt-4o", messages=messages, model_settings=ModelSettings(max_tokens=100)) as stream:
        async for chunk in stream:
            # FIX: Handle PartStartEvent which contains initial text
            if hasattr(chunk, 'part') and hasattr(chunk.part, 'content'):
                collected_text += str(chunk.part.content)
            # Handle PartDeltaEvent with delta content
            elif hasattr(chunk, 'delta') and chunk.delta:
                if hasattr(chunk.delta, 'content_delta') and chunk.delta.content_delta:
                    collected_text += chunk.delta.content_delta

    # Now this should pass!
    assert "1" in collected_text, f"Expected '1' in output but got: {collected_text}"
    assert "2" in collected_text
    assert "3" in collected_text
    assert "4" in collected_text
    assert "5" in collected_text


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_api_streaming_call_4(memory_logger):
    """Test direct API streaming (call 4) - identical to call 3."""
    assert not memory_logger.pop()

    IDENTICAL_PROMPT = "Count from 1 to 5."
    messages = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

    collected_text = ""
    async with model_request_stream(model="openai:gpt-4o", messages=messages, model_settings=ModelSettings(max_tokens=100)) as stream:
        async for chunk in stream:
            # FIX: Handle PartStartEvent which contains initial text
            if hasattr(chunk, 'part') and hasattr(chunk.part, 'content'):
                collected_text += str(chunk.part.content)
            # Handle PartDeltaEvent with delta content
            elif hasattr(chunk, 'delta') and chunk.delta:
                if hasattr(chunk.delta, 'content_delta') and chunk.delta.content_delta:
                    collected_text += chunk.delta.content_delta

    # Now this should pass!
    assert "1" in collected_text, f"Expected '1' in output but got: {collected_text}"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_api_streaming_early_break_call_5(memory_logger):
    """Test direct API streaming with early break (call 5) - should still get first few chars including '1'."""
    assert not memory_logger.pop()

    IDENTICAL_PROMPT = "Count from 1 to 5."
    messages = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

    collected_text = ""
    i = 0
    async with model_request_stream(model="openai:gpt-4o", messages=messages, model_settings=ModelSettings(max_tokens=100)) as stream:
        async for chunk in stream:
            # FIX: Handle PartStartEvent which contains initial text
            if hasattr(chunk, 'part') and hasattr(chunk.part, 'content'):
                collected_text += str(chunk.part.content)
            # Handle PartDeltaEvent with delta content
            elif hasattr(chunk, 'delta') and chunk.delta:
                if hasattr(chunk.delta, 'content_delta') and chunk.delta.content_delta:
                    collected_text += chunk.delta.content_delta

            i += 1
            if i >= 3:
                break

    # Even with early break after 3 chunks, we should capture text from PartStartEvent (chunk 1)
    print(f"Collected text: '{collected_text}'")
    assert len(collected_text) > 0, f"Expected some text even with early break but got empty string"
    # Verify we're capturing PartStartEvent by checking we got text before breaking at chunk 3
    assert collected_text, f"Should have captured text from PartStartEvent or first delta"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_api_streaming_no_duplication(memory_logger):
    """Test that direct API streaming doesn't duplicate output and captures all text in span."""
    assert not memory_logger.pop()

    collected_text = ""
    chunk_count = 0

    # Use direct API streaming
    messages = [ModelRequest(parts=[UserPromptPart(content="Count from 1 to 5, separated by commas.")])]
    async with model_request_stream(
        messages=messages,
        model_settings=ModelSettings(max_tokens=100),
        model="openai:gpt-4o",
    ) as response:
        async for chunk in response:
            chunk_count += 1
            # Extract text from chunk
            text = None
            if hasattr(chunk, 'part') and hasattr(chunk.part, 'content'):
                text = str(chunk.part.content)
            elif hasattr(chunk, 'delta') and chunk.delta:
                if hasattr(chunk.delta, 'content_delta') and chunk.delta.content_delta:
                    text = chunk.delta.content_delta

            if text:
                collected_text += text

    print(f"Collected text from stream: '{collected_text}'")
    print(f"Total chunks: {chunk_count}")

    # Verify we collected complete text
    assert len(collected_text) > 0, "Should have collected text from stream"
    assert "1" in collected_text, "Should have '1' in output"

    # Check span captured the full output
    spans = memory_logger.pop()
    assert len(spans) >= 1, f"Expected at least 1 span, got {len(spans)}"

    # Find the model_request_stream span
    stream_span = next((s for s in spans if "model_request_stream" in s["span_attributes"]["name"]), None)
    assert stream_span is not None, "model_request_stream span not found"

    # Check that span output contains the full text, not just "1,"
    span_output = stream_span.get("output", {})
    print(f"Span output: {span_output}")

    # The span should capture the full response
    if "response" in span_output and "parts" in span_output["response"]:
        parts = span_output["response"]["parts"]
        span_text = "".join(str(p.get("content", "")) for p in parts if isinstance(p, dict))
        print(f"Span captured text: '{span_text}'")
        # Should have more than just "1,"
        assert len(span_text) > 2, f"Span should capture more than just '1,', got: '{span_text}'"
        assert "1" in span_text, "Span should contain '1'"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_api_streaming_no_duplication_comprehensive(memory_logger):
    """Comprehensive test matching golden test setup to verify no duplication and full output capture."""
    assert not memory_logger.pop()

    # Match golden test exactly
    IDENTICAL_PROMPT = "Count from 1 to 5."
    IDENTICAL_SETTINGS = ModelSettings(max_tokens=100)

    messages = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

    collected_text = ""
    chunk_types = []
    seen_delta = False

    async with model_request_stream(messages=messages, model_settings=IDENTICAL_SETTINGS, model="openai:gpt-4o") as stream:
        async for chunk in stream:
            # Track chunk types
            if hasattr(chunk, 'part') and hasattr(chunk.part, 'content') and not seen_delta:
                chunk_types.append(('PartStartEvent', str(chunk.part.content)))
                text = str(chunk.part.content)
                collected_text += text
            elif hasattr(chunk, 'delta') and chunk.delta:
                seen_delta = True
                if hasattr(chunk.delta, 'content_delta') and chunk.delta.content_delta:
                    chunk_types.append(('PartDeltaEvent', chunk.delta.content_delta))
                    text = chunk.delta.content_delta
                    collected_text += text

    print(f"\nCollected text: '{collected_text}'")
    print(f"Total chunks received: {len(chunk_types)}")
    print(f"All chunk types:")
    for i, (chunk_type, content) in enumerate(chunk_types):
        print(f"  {i}: {chunk_type} = {content!r}")

    # Verify no duplication in collected text
    # Expected: "Sure! Here you go:\n\n1, 2, 3, 4, 5." or similar (length ~30)
    # Should NOT be duplicated
    assert len(collected_text) < 60, f"Text seems duplicated (too long): '{collected_text}' (len={len(collected_text)})"
    assert collected_text.count("1, 2, 3") == 1, f"Text should appear once, not duplicated: '{collected_text}'"

    # Check span
    spans = memory_logger.pop()
    print(f"Number of spans: {len(spans)}")
    for i, s in enumerate(spans):
        print(f"Span {i}: {s['span_attributes']['name']} (type: {s['span_attributes'].get('type', 'N/A')})")
        if 'span_parents' in s and s['span_parents']:
            print(f"  Parents: {s['span_parents']}")

    # Should have 1 or 2 spans (direct API wrapper + potentially model wrapper)
    assert len(spans) >= 1, f"Expected at least 1 span, got {len(spans)}"

    # Find the model_request_stream span
    stream_span = next((s for s in spans if "model_request_stream" in s["span_attributes"]["name"]), None)
    assert stream_span is not None, "model_request_stream span not found"

    # Check that span output is not empty and captures reasonable amount of text
    span_output = stream_span.get("output", {})
    print(f"Span output keys: {span_output.keys() if span_output else 'None'}")

    if "parts" in span_output:
        parts = span_output.get("parts", [])
        print(f"Span parts: {parts}")
        if parts and len(parts) > 0:
            first_part = parts[0]
            print(f"First part type: {type(first_part)}")
            print(f"First part: {first_part}")
            if isinstance(first_part, dict):
                part_content = first_part.get("content", "")
                print(f"Part content: '{part_content}'")
                print(f"Part content length: {len(part_content)}")
                # The span should capture the FULL text, not just "1,"
                assert len(part_content) > 5, f"Span should capture full text, got: '{part_content}'"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_async_generator_pattern_call_6(memory_logger):
    """Test async generator pattern (call 6) - wrapping stream in async generator."""
    assert not memory_logger.pop()

    IDENTICAL_PROMPT = "Count from 1 to 5."

    async def stream_with_async_generator(prompt: str):
        """Wrap the stream in an async generator (customer pattern)."""
        agent = Agent("openai:gpt-4o", model_settings=ModelSettings(max_tokens=100))
        async for event in agent.run_stream_events(prompt):
            yield event

    collected_text = ""
    i = 0
    async for event in stream_with_async_generator(IDENTICAL_PROMPT):
        # run_stream_events returns ResultEvent objects with different structure
        # Try to extract text from whatever event type we get
        if hasattr(event, 'content') and event.content:
            collected_text += str(event.content)
        elif hasattr(event, 'part') and hasattr(event.part, 'content'):
            collected_text += str(event.part.content)
        elif hasattr(event, 'delta') and event.delta:
            if hasattr(event.delta, 'content_delta') and event.delta.content_delta:
                collected_text += event.delta.content_delta

        i += 1
        if i >= 3:
            break

    # This should capture something
    print(f"Collected text from generator: '{collected_text}'")
    assert len(collected_text) > 0, f"Expected some text from async generator but got empty string"


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
    """Test that system_prompt from agent config appears in input (it's semantically part of LLM input)."""
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

    # Verify system_prompt is in input (because it's semantically part of the LLM input)
    assert "system_prompt" in agent_span["input"], "system_prompt should be in agent_run input"
    assert agent_span["input"]["system_prompt"] == system_prompt, "system_prompt should be the actual string, not a method reference"

    # Verify system_prompt is NOT in metadata
    assert "system_prompt" not in agent_span["metadata"], "system_prompt should NOT be in agent_run metadata"

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


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_stream_early_break_async_generator(memory_logger):
    """Test breaking early from an async generator wrapper around a stream.

    This reproduces the 'Token was created in a different Context' error that occurs
    when breaking early from async generators. The cleanup happens in a different
    async context, causing ContextVar token errors.

    Our fix: Clear the context token before cleanup to make unset_current() use
    the safe set(None) path instead of reset(token).
    """
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Count from 1 to 5")])]

    async def stream_wrapper():
        """Wrap the stream in an async generator (common customer pattern)."""
        async with model_request_stream(model=MODEL, messages=messages) as stream:
            count = 0
            async for chunk in stream:
                yield chunk
                count += 1
                if count >= 3:
                    # Break early - this triggers cleanup in different context
                    break

    start = time.time()
    chunk_count = 0

    # This should NOT raise ValueError about "different Context"
    async for chunk in stream_wrapper():
        chunk_count += 1

    end = time.time()

    # Should not raise ValueError about context token
    assert chunk_count == 3

    # Check spans - should have created a span despite early break
    spans = memory_logger.pop()
    assert len(spans) >= 1, "Should have at least one span even with early break"

    span = spans[0]
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert span["span_attributes"]["name"] == "model_request_stream"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_stream_early_break(memory_logger):
    """Test breaking early from agent.run_stream() context manager.

    Verifies that breaking early from the stream doesn't cause context token errors
    and that spans are still properly logged.
    """
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=100))

    start = time.time()
    text_count = 0

    # Break early from stream - should not raise context token error
    async with agent.run_stream("Count from 1 to 10") as result:
        async for text in result.stream_text(delta=True):
            text_count += 1
            if text_count >= 3:
                break  # Early break

    end = time.time()

    assert text_count == 3

    # Check spans - should have created spans despite early break
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run_stream + chat), got {len(spans)}"

    # Find agent_run_stream and chat spans
    agent_span = next((s for s in spans if "agent_run_stream" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run_stream span not found"
    assert chat_span is not None, "chat span not found"

    # Verify spans have proper structure even with early break
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert chat_span["span_parents"] == [agent_span["id"]]
    _assert_metrics_are_valid(agent_span["metrics"], start, end)
    _assert_metrics_are_valid(chat_span["metrics"], start, end)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_binary_content(memory_logger):
    """Test that binary content (images) is properly serialized with attachment references.

    Verifies that:
    1. Both agent span and model span properly serialize binary content
    2. Attachment references are created instead of embedding raw binary data
    3. The attachment reference format matches expected structure
    """
    from pydantic_ai.models.function import BinaryContent

    assert not memory_logger.pop()

    # Use a small test image
    image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=50))

    start = time.time()
    result = await agent.run(
        [
            BinaryContent(data=image_data, media_type="image/png"),
            "What color is this image?",
        ]
    )
    end = time.time()

    assert result.output
    assert isinstance(result.output, str)

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run and chat spans
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run span not found"
    assert chat_span is not None, "chat span not found"

    # Verify agent span input has proper attachment reference
    agent_input = agent_span["input"]
    assert "user_prompt" in agent_input
    assert isinstance(agent_input["user_prompt"], list)
    assert len(agent_input["user_prompt"]) == 2

    # First item should be serialized binary content with attachment reference
    binary_item = agent_input["user_prompt"][0]
    assert isinstance(binary_item, dict)
    assert binary_item["type"] == "binary"
    assert "attachment" in binary_item

    attachment = binary_item["attachment"]
    # Attachment might be an Attachment object (during testing) or a reference dict (in production)
    from braintrust.logger import Attachment as AttachmentClass
    if isinstance(attachment, AttachmentClass):
        # It's the Attachment object - check its reference
        attachment_ref = attachment.reference
        assert attachment_ref["type"] == "braintrust_attachment"
        assert attachment_ref["content_type"] == "image/png"
        assert attachment_ref["filename"] == "file.png"
        assert "key" in attachment_ref
        assert isinstance(attachment_ref["key"], str)
    else:
        # It's already been replaced with the reference dict
        assert isinstance(attachment, dict)
        assert attachment["type"] == "braintrust_attachment"
        assert attachment["content_type"] == "image/png"
        assert attachment["filename"] == "file.png"
        assert "key" in attachment
        assert isinstance(attachment["key"], str)

    # Second item should be the text
    assert agent_input["user_prompt"][1] == "What color is this image?"

    # Verify chat span (model class) also has proper attachment references
    chat_input = chat_span["input"]
    assert "messages" in chat_input
    assert isinstance(chat_input["messages"], list)
    assert len(chat_input["messages"]) > 0

    # Find the message with parts
    user_message = None
    for msg in chat_input["messages"]:
        if isinstance(msg, dict) and "parts" in msg:
            user_message = msg
            break

    assert user_message is not None, "User message with parts not found in chat span"

    # Check that parts contain properly serialized content with attachment references
    parts = user_message["parts"]
    assert isinstance(parts, list)

    # Find the part with binary content
    binary_part = None
    text_found = False
    for part in parts:
        if isinstance(part, dict) and part.get("part_kind") == "user-prompt":
            # Check if content has binary with attachment
            content = part.get("content")
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "binary":
                        binary_part = item
                    elif isinstance(item, str) and "color" in item.lower():
                        text_found = True

    assert binary_part is not None, "Binary content with attachment not found in chat span parts"
    assert text_found, "Text content not found in chat span parts"
    assert "attachment" in binary_part

    chat_attachment = binary_part["attachment"]
    # Attachment might be an Attachment object (during testing) or a reference dict (in production)
    from braintrust.logger import Attachment as AttachmentClass
    if isinstance(chat_attachment, AttachmentClass):
        # It's the Attachment object - check its reference
        attachment_ref = chat_attachment.reference
        assert attachment_ref["type"] == "braintrust_attachment"
        assert attachment_ref["content_type"] == "image/png"
        assert "key" in attachment_ref
        # Verify no raw binary data is present in attachment reference
        assert "data" not in attachment_ref, "Raw binary data should not be in attachment reference"
    else:
        # It's already been replaced with the reference dict
        assert isinstance(chat_attachment, dict)
        assert chat_attachment["type"] == "braintrust_attachment"
        assert chat_attachment["content_type"] == "image/png"
        assert "key" in chat_attachment
        # Verify no raw binary data is present (data should not be a key in attachment)
        assert "data" not in chat_attachment, "Raw binary data should not be in attachment reference"

    # Verify spans have proper structure
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    # Chat span should have agent_span as parent (use span_id not id)
    assert "span_parents" in chat_span
    assert len(chat_span["span_parents"]) == 1
    assert chat_span["span_parents"][0] == agent_span["span_id"]
    _assert_metrics_are_valid(agent_span["metrics"], start, end)
    _assert_metrics_are_valid(chat_span["metrics"], start, end)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_tool_execution(memory_logger):
    """Test that tool execution creates proper span hierarchy.

    Verifies that:
    1. Agent creates proper spans for tool calls
    2. Tool execution is captured in spans (ideally with "running tools" parent)
    3. Individual tool calls create child spans
    """
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=200))

    @agent.tool_plain
    def calculate(operation: str, a: float, b: float) -> str:
        """Perform a mathematical calculation.

        Args:
            operation: The mathematical operation (add, subtract, multiply, divide)
            a: First number
            b: Second number
        """
        ops = {
            "add": a + b,
            "subtract": a - b,
            "multiply": a * b,
            "divide": a / b if b != 0 else "Error: Division by zero",
        }
        return str(ops.get(operation, "Invalid operation"))

    start = time.time()
    result = await agent.run("What is 127 multiplied by 49?")
    end = time.time()

    assert result.output
    assert "6" in str(result.output) and "223" in str(result.output)  # Result contains 6223 (possibly formatted)

    # Check spans
    spans = memory_logger.pop()

    # We should have at least agent_run and chat spans
    # TODO: Add "running tools" parent span and "running tool: calculate" child span
    assert len(spans) >= 2, f"Expected at least 2 spans, got {len(spans)}"

    # Find agent_run span
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"]), None)
    assert agent_span is not None, "agent_run span not found"

    # Verify that toolsets are captured in input with correct tool names
    assert "toolsets" in agent_span["input"], "toolsets should be in input (not metadata)"
    toolsets = agent_span["input"]["toolsets"]
    assert len(toolsets) > 0, "At least one toolset should be present"

    # Find the agent toolset
    agent_toolset = None
    for ts in toolsets:
        if ts.get("id") == "<agent>":
            agent_toolset = ts
            break

    assert agent_toolset is not None, "Agent toolset not found"
    assert "tools" in agent_toolset, "tools should be in agent toolset"

    # Verify calculate tool is present (tools are now dicts with full schemas in input)
    tools = agent_toolset["tools"]
    assert isinstance(tools, list), "tools should be a list"
    tool_names = [t["name"] for t in tools if isinstance(t, dict)]
    assert "calculate" in tool_names, f"calculate tool should be in tools list, got: {tool_names}"

    # Verify toolsets are NOT in metadata (following the principle: agent.run() accepts it)
    assert "toolsets" not in agent_span["metadata"], "toolsets should NOT be in metadata"


def test_tool_execution_creates_spans(memory_logger):
    """Test that executing tools creates proper traced spans with correct parent hierarchy.

    Expected hierarchy:
    - agent_run
      - chat gpt-4o (first call, returns tool call)
        - calculate (tool execution should be child of the chat span that requested it)
      - chat gpt-4o (second call with tool result, returns final answer)
    """
    assert not memory_logger.pop()

    start = time.time()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=500))

    @agent.tool_plain
    def calculate(operation: str, a: float, b: float) -> float:
        """Perform a mathematical calculation."""
        if operation == "multiply":
            return a * b
        elif operation == "add":
            return a + b
        else:
            return 0.0

    # Run the agent with a query that will use the tool
    result = agent.run_sync("What is 127 multiplied by 49?")
    end = time.time()

    # Get logged spans
    spans = memory_logger.pop()

    # Debug: Print all spans
    print("\n=== ALL SPANS ===")
    for i, s in enumerate(spans):
        print(f"Span {i}:")
        print(f"  name: {s['span_attributes']['name']}")
        print(f"  type: {s['span_attributes'].get('type')}")
        print(f"  span_id: {s.get('span_id')}")
        print(f"  span_parents: {s.get('span_parents')}")

    # Find spans by type
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"]), None)
    chat_spans = [s for s in spans if "chat" in s["span_attributes"]["name"]]
    tool_spans = [s for s in spans if "calculate" in s["span_attributes"].get("name", "")]

    # Assertions
    assert agent_span is not None, "agent_run span should exist"
    assert len(chat_spans) >= 1, f"Expected at least 1 chat span, got {len(chat_spans)}"
    assert len(tool_spans) > 0, f"Expected at least one tool span for 'calculate', got spans: {[s['span_attributes']['name'] for s in spans]}"

    tool_span = tool_spans[0]

    # Verify tool span has correct structure
    assert tool_span["span_attributes"]["name"] == "calculate", "Tool span should be named after the tool function"
    assert tool_span["span_attributes"]["type"] == SpanTypeAttribute.TOOL, "Tool span should be type 'tool'"

    # Verify tool span has input (the arguments)
    assert "input" in tool_span, "Tool span should have input"
    tool_input = tool_span["input"]
    assert "args" in tool_input, "Tool input should contain args"

    # Verify tool span has output (the return value)
    assert "output" in tool_span, "Tool span should have output"

    # CRITICAL: Verify tool span is child of the FIRST chat span (the one that made the tool call)
    # NOT a child of agent_run span
    first_chat_span = chat_spans[0]

    print("\n=== PARENT VERIFICATION ===")
    print(f"First chat span ID: {first_chat_span.get('span_id')}")
    print(f"Tool span parents: {tool_span.get('span_parents')}")
    print(f"Agent span ID: {agent_span.get('span_id')}")

    # The tool span should be a child of the first chat span (the one that returned the tool call)
    assert len(tool_span["span_parents"]) > 0, "Tool span should have a parent"
    tool_parent_id = tool_span["span_parents"][0]

    # THIS IS THE KEY ASSERTION: tool should be child of chat span, not agent span
    assert tool_parent_id == first_chat_span["span_id"], \
        f"Tool span should be child of first chat span (that made the tool call), " \
        f"but got parent={tool_parent_id}, first_chat_span={first_chat_span['span_id']}, " \
        f"agent_span={agent_span['span_id']}"

    # Verify timing
    _assert_metrics_are_valid(tool_span["metrics"], start, end)

    # Check that the agent span has tool-related information in message history
    messages = result.all_messages()
    assert len(messages) >= 3, f"Expected at least 3 messages in history, got {len(messages)}"

    # Find the tool call message
    tool_call_msg = None
    tool_return_msg = None
    for msg in messages:
        if hasattr(msg, "parts"):
            for part in msg.parts:
                if hasattr(part, "part_kind"):
                    if part.part_kind == "tool-call":
                        tool_call_msg = msg
                        assert hasattr(part, "tool_name")
                        assert part.tool_name == "calculate"
                    elif part.part_kind == "tool-return":
                        tool_return_msg = msg
                        assert hasattr(part, "content")
                        # The tool should have been executed (content could be 0.0 or 6223 depending on operation parsing)

    assert tool_call_msg is not None, "Tool call message not found in history"
    assert tool_return_msg is not None, "Tool return message not found in history"

    # Verify spans have proper structure
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    _assert_metrics_are_valid(agent_span["metrics"], start, end)


def test_agent_tool_metadata_extraction(memory_logger):
    """Test that agent tools are properly extracted with full schemas in INPUT (not metadata).

    Principle: If agent.run() accepts it, it goes in input only.
    """
    from braintrust.wrappers.pydantic_ai import _build_agent_input_and_metadata

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=100))

    # Add multiple tools with different signatures
    @agent.tool_plain
    def calculate(operation: str, a: float, b: float) -> str:
        """Perform a mathematical calculation."""
        return str(a + b)

    @agent.tool_plain
    def get_weather(location: str) -> str:
        """Get weather for a location."""
        return f"Weather in {location}"

    @agent.tool_plain
    def search_database(query: str, limit: int = 10) -> str:
        """Search the database."""
        return "Results"

    # Extract metadata using the actual function signature
    args = ("Test prompt",)
    kwargs = {}
    input_data, metadata = _build_agent_input_and_metadata(args, kwargs, agent)

    # Verify toolsets are in INPUT (since agent.run() accepts toolsets parameter)
    assert "toolsets" in input_data, "toolsets should be in input (can be passed to agent.run())"
    toolsets = input_data["toolsets"]
    assert len(toolsets) > 0, "At least one toolset should be present"

    # Verify toolsets are NOT in metadata (following the principle)
    assert "toolsets" not in metadata, "toolsets should NOT be in metadata (it's a run() parameter)"

    # Find the agent toolset
    agent_toolset = None
    for ts in toolsets:
        if ts.get("id") == "<agent>":
            agent_toolset = ts
            break

    assert agent_toolset is not None, "Agent toolset not found in input"
    assert agent_toolset.get("label") == "the agent", "Agent toolset should have correct label"
    assert "tools" in agent_toolset, "tools should be in agent toolset"

    # Verify all tools are present with FULL SCHEMAS
    tools = agent_toolset["tools"]
    assert isinstance(tools, list), "tools should be a list"
    assert len(tools) == 3, f"Should have exactly 3 tools, got {len(tools)}"

    # Check each tool has full schema information
    tool_names = [t["name"] for t in tools]
    assert "calculate" in tool_names, f"calculate tool should be present, got: {tool_names}"
    assert "get_weather" in tool_names, f"get_weather tool should be present, got: {tool_names}"
    assert "search_database" in tool_names, f"search_database tool should be present, got: {tool_names}"

    # Verify calculate tool has full schema
    calculate_tool = next(t for t in tools if t["name"] == "calculate")
    assert "description" in calculate_tool, "Tool should have description"
    assert "Perform a mathematical calculation" in calculate_tool["description"]
    assert "parameters" in calculate_tool, "Tool should have parameters schema"
    params = calculate_tool["parameters"]
    assert "properties" in params, "Parameters should have properties"
    assert "operation" in params["properties"], "Should have 'operation' parameter"
    assert "a" in params["properties"], "Should have 'a' parameter"
    assert "b" in params["properties"], "Should have 'b' parameter"
    assert params["properties"]["operation"]["type"] == "string"
    assert params["properties"]["a"]["type"] == "number"
    assert params["properties"]["b"]["type"] == "number"

    # Verify search_database has optional parameter
    search_tool = next(t for t in tools if t["name"] == "search_database")
    assert "parameters" in search_tool
    search_params = search_tool["parameters"]
    assert "query" in search_params["properties"]
    assert "limit" in search_params["properties"]
    # 'query' should be required, 'limit' should be optional (has default)
    assert "query" in search_params.get("required", [])


def test_agent_without_tools_metadata():
    """Test metadata extraction for agent without tools."""
    from braintrust.wrappers.pydantic_ai import _build_agent_input_and_metadata

    # Agent with no tools
    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=50))

    args = ("Test prompt",)
    kwargs = {}
    input_data, metadata = _build_agent_input_and_metadata(args, kwargs, agent)

    # Should have toolsets in input (even if empty)
    # Note: Pydantic AI agents always have some toolsets (e.g., for output parsing)
    # so we just verify the structure exists
    assert isinstance(input_data.get("toolsets"), (list, type(None))), "toolsets should be list or None in input"


def test_agent_tool_with_custom_name():
    """Test that tools with custom names are properly extracted with schemas in input."""
    from braintrust.wrappers.pydantic_ai import _build_agent_input_and_metadata

    agent = Agent(MODEL)

    # Add tool with custom name
    @agent.tool_plain(name="custom_calculator")
    def calc(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    args = ("Test",)
    kwargs = {}
    input_data, metadata = _build_agent_input_and_metadata(args, kwargs, agent)

    # Verify custom name is used in input (not metadata)
    assert "toolsets" in input_data
    assert "toolsets" not in metadata, "toolsets should not be in metadata"

    agent_toolset = next((ts for ts in input_data["toolsets"] if ts.get("id") == "<agent>"), None)
    assert agent_toolset is not None
    tools = agent_toolset.get("tools", [])

    # The tool should be a dict with schema info
    assert len(tools) == 1, f"Should have 1 tool, got {len(tools)}"
    tool = tools[0]
    assert isinstance(tool, dict), "Tool should be a dict with schema"
    assert tool["name"] == "custom_calculator", f"Should use custom name, got: {tool.get('name')}"
    assert "description" in tool, "Tool should have description"
    assert "parameters" in tool, "Tool should have parameters schema"
    assert "a" in tool["parameters"]["properties"]
    assert "b" in tool["parameters"]["properties"]


def test_explicit_toolsets_kwarg_in_input():
    """Test that explicitly passed toolsets kwarg goes to input (not just metadata)."""
    from braintrust.wrappers.pydantic_ai import _build_agent_input_and_metadata

    agent = Agent(MODEL)

    # Add a tool to the agent
    @agent.tool_plain
    def helper_tool() -> str:
        """A helper tool."""
        return "help"

    # Simulate passing toolsets as explicit kwarg (would be a different toolset in practice)
    # For testing, we'll just pass the string "custom" to see it in input
    args = ("Test",)
    kwargs = {"toolsets": "custom_toolset_marker"}  # Simplified for testing
    input_data, metadata = _build_agent_input_and_metadata(args, kwargs, agent)

    # Toolsets passed as kwargs should be in input
    assert "toolsets" in input_data, "explicitly passed toolsets should be in input"


@pytest.mark.vcr
def test_reasoning_tokens_extraction(memory_logger):
    """Test that reasoning tokens are extracted from model responses.

    For reasoning models like o1/o3, usage.details.reasoning_tokens should be
    captured in the metrics field.
    """
    assert not memory_logger.pop()

    # Mock a response that has reasoning tokens
    from unittest.mock import MagicMock

    # Create a mock response with reasoning tokens
    mock_response = MagicMock()
    mock_response.parts = [
        MagicMock(
            part_kind="thinking",
            content="Let me think about this...",
        ),
        MagicMock(
            part_kind="text",
            content="The answer is 42",
        ),
    ]
    mock_response.usage = MagicMock()
    mock_response.usage.input_tokens = 10
    mock_response.usage.output_tokens = 20
    mock_response.usage.total_tokens = 30
    mock_response.usage.cache_read_tokens = 0
    mock_response.usage.cache_write_tokens = 0
    mock_response.usage.details = MagicMock()
    mock_response.usage.details.reasoning_tokens = 128

    # Test the metric extraction function directly
    from braintrust.wrappers.pydantic_ai import _extract_response_metrics

    start_time = time.time()
    end_time = start_time + 5.0

    metrics = _extract_response_metrics(mock_response, start_time, end_time)

    # Verify all metrics are present
    assert metrics is not None, "Should extract metrics"
    assert "prompt_tokens" in metrics, "Should have prompt_tokens"
    assert metrics["prompt_tokens"] == 10.0
    assert "completion_tokens" in metrics, "Should have completion_tokens"
    assert metrics["completion_tokens"] == 20.0
    assert "tokens" in metrics, "Should have total tokens"
    assert metrics["tokens"] == 30.0
    assert "completion_reasoning_tokens" in metrics, "Should have completion_reasoning_tokens"
    assert metrics["completion_reasoning_tokens"] == 128.0, f"Expected 128.0, got {metrics['completion_reasoning_tokens']}"
    assert "duration" in metrics
    assert "start" in metrics
    assert "end" in metrics


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_run_stream_structured_output(memory_logger):
    """Test Agent.run_stream() with structured output (Pydantic model).

    Verifies that streaming structured output creates proper spans and
    that the result can be accessed via get_output() method.
    """
    assert not memory_logger.pop()

    class Product(BaseModel):
        name: str
        price: float

    agent = Agent(
        MODEL,
        output_type=Product,
        model_settings=ModelSettings(max_tokens=200)
    )

    start = time.time()
    async with agent.run_stream("Create a product: wireless mouse for $29.99") as result:
        # For structured output, use get_output() instead of streaming text
        product = await result.get_output()
    end = time.time()

    # Verify structured output
    assert isinstance(product, Product)
    assert product.name
    assert product.price > 0

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) >= 2, f"Expected at least 2 spans (agent_run_stream + chat), got {len(spans)}"

    # Find agent_run_stream and chat spans
    agent_span = next((s for s in spans if "agent_run_stream" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run_stream span not found"
    assert chat_span is not None, "chat span not found"

    # Check agent span
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    _assert_metrics_are_valid(agent_span["metrics"], start, end)

    # Check chat span is nested
    assert chat_span["span_parents"] == [agent_span["span_id"]], "chat span should be nested under agent_run_stream"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)
