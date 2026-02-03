# pyright: reportUntypedFunctionDecorator=false
# pyright: reportUnknownMemberType=false
# pyright: reportUnknownParameterType=false
# pyright: reportPrivateUsage=false
import asyncio
import time

import pytest
from braintrust import logger, setup_pydantic_ai, traced
from braintrust.span_types import SpanTypeAttribute
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.test_utils import verify_autoinstrument_script
from pydantic import BaseModel
from pydantic_ai import Agent, ModelSettings
from pydantic_ai.messages import ModelRequest, UserPromptPart

PROJECT_NAME = "test-pydantic-ai-integration"
MODEL = "openai:gpt-4o-mini"  # Use cheaper model for tests
TEST_PROMPT = "What is 2+2? Answer with just the number."


@pytest.fixture(scope="module", autouse=True)
def setup_wrapper():
    """Setup pydantic_ai wrapper before any tests run."""
    setup_pydantic_ai(project_name=PROJECT_NAME)
    yield


@pytest.fixture(scope="module")
def direct():
    """Provide pydantic_ai.direct module after setup_wrapper has run."""
    import pydantic_ai.direct as direct_module
    return direct_module


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

    # Check spans - should have parent agent_run_sync + nested spans
    spans = memory_logger.pop()
    assert len(spans) >= 2, f"Expected at least 2 spans (agent_run_sync + chat), got {len(spans)}"

    # Find agent_run_sync and chat spans
    agent_sync_span = next((s for s in spans if "agent_run_sync" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_sync_span is not None, "agent_run_sync span not found"
    assert chat_span is not None, "chat span not found"

    # Check agent span
    assert agent_sync_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_sync_span["metadata"]["model"] == "gpt-4o-mini"
    assert agent_sync_span["metadata"]["provider"] == "openai"
    assert TEST_PROMPT in str(agent_sync_span["input"])
    assert "4" in str(agent_sync_span["output"])
    _assert_metrics_are_valid(agent_sync_span["metrics"], start, end)

    # Check chat span is a descendant of agent_run_sync span
    # Build span tree to verify nesting
    span_by_id = {s["span_id"]: s for s in spans}

    def is_descendant(child_span, ancestor_id):
        """Check if child_span is a descendant of ancestor_id."""
        if not child_span.get("span_parents"):
            return False
        if ancestor_id in child_span["span_parents"]:
            return True
        # Check if any parent is a descendant
        for parent_id in chat_span["span_parents"]:
            if parent_id in span_by_id and is_descendant(span_by_id[parent_id], ancestor_id):
                return True
        return False


    assert is_descendant(chat_span, agent_sync_span["span_id"]), "chat span should be nested under agent_run_sync"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)

    # Agent spans should have token metrics
    assert "prompt_tokens" in agent_sync_span["metrics"]
    assert "completion_tokens" in agent_sync_span["metrics"]


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

    # CRITICAL: Check that time_to_first_token is captured
    assert "time_to_first_token" in agent_span["metrics"], "agent_run_stream span should have time_to_first_token metric"
    ttft = agent_span["metrics"]["time_to_first_token"]
    duration = agent_span["metrics"]["duration"]

    # time_to_first_token should be reasonable: > 0 and < duration
    assert ttft > 0, f"time_to_first_token should be > 0, got {ttft}"
    assert ttft <= duration, f"time_to_first_token ({ttft}s) should be <= duration ({duration}s)"
    assert ttft < 3.0, f"time_to_first_token should be < 3s for API call, got {ttft}s"

    # Debug: Print full span data
    print(f"\n=== AGENT SPAN ===")
    print(f"ID: {agent_span['id']}")
    print(f"span_id: {agent_span['span_id']}")
    print(f"metrics: {agent_span['metrics']}")
    print(f"time_to_first_token: {ttft}s")
    print(f"\n=== CHAT SPAN ===")
    print(f"ID: {chat_span['id']}")
    print(f"span_id: {chat_span['span_id']}")
    print(f"span_parents: {chat_span['span_parents']}")
    print(f"metrics: {chat_span['metrics']}")

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
async def test_direct_model_request(memory_logger, direct):
    """Test direct API model_request()."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content=TEST_PROMPT)])]

    start = time.time()
    response = await direct.model_request(model=MODEL, messages=messages)
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
def test_direct_model_request_sync(memory_logger, direct):
    """Test direct API model_request_sync()."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content=TEST_PROMPT)])]

    start = time.time()
    response = direct.model_request_sync(model=MODEL, messages=messages)
    end = time.time()

    # Verify response
    assert response.parts
    assert "4" in str(response.parts[0].content)

    # Check spans - direct API may create 2-3 spans depending on wrapping layers
    spans = memory_logger.pop()
    assert len(spans) >= 2

    # Find the model_request_sync span
    span = next((s for s in spans if s["span_attributes"]["name"] == "model_request_sync"), None)
    assert span is not None, "model_request_sync span not found"
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert span["metadata"]["model"] == "gpt-4o-mini"
    assert TEST_PROMPT in str(span["input"])
    _assert_metrics_are_valid(span["metrics"], start, end)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_model_request_with_settings(memory_logger, direct):
    """Test that model_settings appears in input for direct API calls."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Say hello")])]
    custom_settings = ModelSettings(max_tokens=50, temperature=0.7)

    start = time.time()
    result = await direct.model_request(model=MODEL, messages=messages, model_settings=custom_settings)
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
async def test_direct_model_request_stream(memory_logger, direct):
    """Test direct API model_request_stream() - verifies time_to_first_token is captured."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Count from 1 to 3")])]

    start = time.time()
    chunk_count = 0
    async with direct.model_request_stream(model=MODEL, messages=messages) as stream:
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

    # CRITICAL: Verify time_to_first_token is captured in direct streaming
    assert "time_to_first_token" in direct_span["metrics"], "model_request_stream span should have time_to_first_token metric"
    ttft = direct_span["metrics"]["time_to_first_token"]
    duration = direct_span["metrics"]["duration"]

    # time_to_first_token should be reasonable: > 0 and < duration
    assert ttft > 0, f"time_to_first_token should be > 0, got {ttft}"
    assert ttft <= duration, f"time_to_first_token ({ttft}s) should be <= duration ({duration}s)"
    assert ttft < 3.0, f"time_to_first_token should be < 3s for API call, got {ttft}s"

    print(f"✓ Direct stream time_to_first_token: {ttft}s (duration: {duration}s)")


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_direct_model_request_stream_complete_output(memory_logger, direct):
    """Test that direct API streaming captures all text including first chunk from PartStartEvent."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Say exactly: 1, 2, 3")])]

    collected_text = ""
    seen_delta = False
    async with direct.model_request_stream(model=MODEL, messages=messages) as stream:
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
async def test_direct_api_streaming_call_3(memory_logger, direct):
    """Test direct API streaming (call 3) - should output complete '1, 2, 3, 4, 5'."""
    assert not memory_logger.pop()

    IDENTICAL_PROMPT = "Count from 1 to 5."
    messages = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

    collected_text = ""
    async with direct.model_request_stream(model="openai:gpt-4o", messages=messages, model_settings=ModelSettings(max_tokens=100)) as stream:
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
async def test_direct_api_streaming_call_4(memory_logger, direct):
    """Test direct API streaming (call 4) - identical to call 3."""
    assert not memory_logger.pop()

    IDENTICAL_PROMPT = "Count from 1 to 5."
    messages = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

    collected_text = ""
    async with direct.model_request_stream(model="openai:gpt-4o", messages=messages, model_settings=ModelSettings(max_tokens=100)) as stream:
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
async def test_direct_api_streaming_early_break_call_5(memory_logger, direct):
    """Test direct API streaming with early break (call 5) - should still get first few chars including '1'."""
    assert not memory_logger.pop()

    IDENTICAL_PROMPT = "Count from 1 to 5."
    messages = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

    collected_text = ""
    i = 0
    async with direct.model_request_stream(model="openai:gpt-4o", messages=messages, model_settings=ModelSettings(max_tokens=100)) as stream:
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
async def test_direct_api_streaming_no_duplication(memory_logger, direct):
    """Test that direct API streaming doesn't duplicate output and captures all text in span."""
    assert not memory_logger.pop()

    collected_text = ""
    chunk_count = 0

    # Use direct API streaming
    messages = [ModelRequest(parts=[UserPromptPart(content="Count from 1 to 5, separated by commas.")])]
    async with direct.model_request_stream(
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
async def test_direct_api_streaming_no_duplication_comprehensive(memory_logger, direct):
    """Comprehensive test matching golden test setup to verify no duplication and full output capture."""
    assert not memory_logger.pop()

    # Match golden test exactly
    IDENTICAL_PROMPT = "Count from 1 to 5."
    IDENTICAL_SETTINGS = ModelSettings(max_tokens=100)

    messages = [ModelRequest(parts=[UserPromptPart(content=IDENTICAL_PROMPT)])]

    collected_text = ""
    chunk_types = []
    seen_delta = False

    async with direct.model_request_stream(messages=messages, model_settings=IDENTICAL_SETTINGS, model="openai:gpt-4o") as stream:
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
        output_type=MathAnswer,
        model_settings=ModelSettings(max_tokens=200)
    )

    start = time.time()
    result = await agent.run("What is 10 + 15?")
    end = time.time()

    # Verify structured output
    assert isinstance(result.output, MathAnswer)
    assert result.output.answer == 25
    assert result.output.explanation

    # Check spans - should have parent agent_run + nested spans
    spans = memory_logger.pop()
    assert len(spans) >= 2, f"Expected at least 2 spans (agent_run + chat), got {len(spans)}"

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

    # Check chat span is a descendant of agent_run
    span_by_id = {s["span_id"]: s for s in spans}

    def is_descendant(child_span, ancestor_id):
        """Check if child_span is a descendant of ancestor_id."""
        if not child_span.get("span_parents"):
            return False
        if ancestor_id in child_span["span_parents"]:
            return True
        for parent_id in child_span["span_parents"]:
            if parent_id in span_by_id and is_descendant(span_by_id[parent_id], ancestor_id):
                return True
        return False

    assert is_descendant(chat_span, agent_span["span_id"]), "chat span should be nested under agent_run"
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
    assert "Alice" in str(agent_span["output"])
    _assert_metrics_are_valid(agent_span["metrics"], start, end)


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
    assert len(spans) >= 2, f"Expected at least 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run span
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"] and "chat" not in s["span_attributes"]["name"]), None)
    assert agent_span is not None, "agent_run span not found"

    # Model settings passed to run() should be in input (not metadata)
    assert "model_settings" in agent_span["input"]
    settings = agent_span["input"]["model_settings"]
    assert settings["max_tokens"] == 20
    assert settings["temperature"] == 0.5
    assert settings["top_p"] == 0.9
    _assert_metrics_are_valid(agent_span["metrics"], start, end)


@pytest.mark.vcr
def test_agent_run_stream_sync(memory_logger):
    """Test Agent.run_stream_sync() synchronous streaming method - verifies time_to_first_token."""
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=100))

    start = time.time()
    full_text = ""
    result = agent.run_stream_sync("Count from 1 to 3")
    for text in result.stream_text(delta=True):
        full_text += text
    end = time.time()

    # Verify we got streaming content
    assert full_text
    assert any(str(i) in full_text for i in range(1, 4))

    # Check spans - should have parent agent_run_stream_sync + nested spans
    spans = memory_logger.pop()
    assert len(spans) >= 2, f"Expected at least 2 spans (agent_run_stream_sync + chat), got {len(spans)}"

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

    # CRITICAL: Verify time_to_first_token is captured in sync streaming
    assert "time_to_first_token" in agent_span["metrics"], "agent_run_stream_sync span should have time_to_first_token metric"
    ttft = agent_span["metrics"]["time_to_first_token"]
    duration = agent_span["metrics"]["duration"]

    # time_to_first_token should be reasonable: > 0 and < duration
    assert ttft > 0, f"time_to_first_token should be > 0, got {ttft}"
    assert ttft <= duration, f"time_to_first_token ({ttft}s) should be <= duration ({duration}s)"
    assert ttft < 3.0, f"time_to_first_token should be < 3s for API call, got {ttft}s"

    print(f"✓ Sync stream time_to_first_token: {ttft}s (duration: {duration}s)")

    # Check chat span is a descendant of agent_run_stream_sync
    span_by_id = {s["span_id"]: s for s in spans}

    def is_descendant(child_span, ancestor_id):
        """Check if child_span is a descendant of ancestor_id."""
        if not child_span.get("span_parents"):
            return False
        if ancestor_id in child_span["span_parents"]:
            return True
        for parent_id in child_span["span_parents"]:
            if parent_id in span_by_id and is_descendant(span_by_id[parent_id], ancestor_id):
                return True
        return False

    assert is_descendant(chat_span, agent_span["span_id"]), "chat span should be nested under agent_run_stream_sync"
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    assert chat_span["metadata"]["provider"] == "openai"
    # Chat span may not have complete metrics since it's an intermediate span
    assert "start" in chat_span["metrics"]

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
    events = []
    # Consume all events
    async for event in agent.run_stream_events("What is 5+5?"):
        event_count += 1
        events.append(event)
    end = time.time()

    # Verify we got events
    assert event_count > 0, "Should receive at least one event"

    # Check spans - should have agent_run_stream_events span
    spans = memory_logger.pop()
    assert len(spans) >= 1, f"Expected at least 1 span, got {len(spans)}"

    # Find agent_run_stream_events span
    agent_span = next((s for s in spans if "agent_run_stream_events" in s["span_attributes"]["name"]), None)
    assert agent_span is not None, "agent_run_stream_events span not found"

    # Check agent span has basic structure
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    assert "5+5" in str(agent_span["input"]) or "What" in str(agent_span["input"])
    assert agent_span["metrics"]["event_count"] == event_count
    _assert_metrics_are_valid(agent_span["metrics"], start, end)


@pytest.mark.vcr
def test_direct_model_request_stream_sync(memory_logger, direct):
    """Test direct API model_request_stream_sync() - verifies time_to_first_token."""
    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Count from 1 to 3")])]

    start = time.time()
    chunk_count = 0
    with direct.model_request_stream_sync(model=MODEL, messages=messages) as stream:
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

    # CRITICAL: Verify time_to_first_token is captured in sync direct streaming
    assert "time_to_first_token" in span["metrics"], "model_request_stream_sync span should have time_to_first_token metric"
    ttft = span["metrics"]["time_to_first_token"]
    duration = span["metrics"]["duration"]

    # time_to_first_token should be reasonable: > 0 and < duration
    assert ttft > 0, f"time_to_first_token should be > 0, got {ttft}"
    assert ttft <= duration, f"time_to_first_token ({ttft}s) should be <= duration ({duration}s)"
    assert ttft < 3.0, f"time_to_first_token should be < 3s for API call, got {ttft}s"

    print(f"✓ Direct sync stream time_to_first_token: {ttft}s (duration: {duration}s)")


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_stream_early_break_async_generator(memory_logger, direct):
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
        async with direct.model_request_stream(model=MODEL, messages=messages) as stream:
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
            if text_count >= 2:  # Lower threshold - streaming may not produce many chunks
                break  # Early break

    end = time.time()

    assert text_count >= 1  # At least one chunk received

    # Check spans - may have incomplete spans due to early break
    spans = memory_logger.pop()
    assert len(spans) >= 1, f"Expected at least 1 span, got {len(spans)}"

    # Find agent_run_stream span (if created)
    agent_span = next((s for s in spans if "agent_run_stream" in s["span_attributes"]["name"]), None)

    # Verify at least agent_run_stream span exists and has basic structure
    if agent_span:
        assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
        # Metrics may be incomplete due to early break
        assert "start" in agent_span["metrics"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_stream_buffer_pattern_early_return(memory_logger, direct):
    """Test the _stream_single/_buffer_stream pattern with early return.

    This tests a common customer pattern where:
    1. An async generator wraps a stream and yields chunks + final response
    2. A consumer function returns early when it sees the final ModelResponse
    3. The generator cleanup happens in a different async context

    This pattern would trigger 'Token was created in a different Context' errors
    before the task-tracking fix, because the consumer's early return causes
    the generator to be cleaned up in a different task context.
    """
    from collections.abc import AsyncIterator

    from pydantic_ai.messages import ModelResponse

    assert not memory_logger.pop()

    messages = [ModelRequest(parts=[UserPromptPart(content="Count from 1 to 5")])]

    class LLMStreamResponse:
        """Wrapper for streaming responses."""

        def __init__(self, llm_response, is_final=False):
            self.llm_response = llm_response
            self.is_final = is_final

    async def _stream_single() -> AsyncIterator[LLMStreamResponse]:
        """Async generator that yields streaming chunks and final response."""
        async with direct.model_request_stream(model=MODEL, messages=messages) as stream:
            async for chunk in stream:
                yield LLMStreamResponse(llm_response=chunk, is_final=False)

            # Yield the final response after streaming completes
            response = stream.get()
            yield LLMStreamResponse(llm_response=response, is_final=True)

    async def _buffer_stream() -> LLMStreamResponse:
        """Consumer that returns early when it gets a ModelResponse.

        This early return causes the generator to be cleaned up in a different
        async context than where it was created, triggering the context issue.
        """
        async for event in _stream_single():
            if isinstance(event.llm_response, ModelResponse):
                # Early return - generator cleanup happens in different context
                return event
        raise RuntimeError("No ModelResponse received")

    start = time.time()

    # This should NOT raise ValueError about "different Context"
    result = await _buffer_stream()
    end = time.time()

    # Verify we got the final response
    assert isinstance(result.llm_response, ModelResponse)
    assert result.is_final

    # Check spans - should have created a span despite early generator cleanup
    spans = memory_logger.pop()
    assert len(spans) >= 1, "Should have at least one span even with early return"

    span = spans[0]
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert span["span_attributes"]["name"] == "model_request_stream"
    assert "start" in span["metrics"]
    assert span["metrics"]["start"] >= start
    # "end" may not be present if span was terminated early, but if present it should be valid
    if "end" in span["metrics"]:
        assert span["metrics"]["end"] <= end


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_stream_buffer_pattern_early_return(memory_logger):
    """Test the _stream_single/_buffer_stream pattern with agent.run_stream().

    This tests the same buffer/stream pattern but with the high-level Agent API
    to ensure _AgentStreamWrapper also handles context cleanup correctly.

    Pattern:
    1. An async generator wraps agent.run_stream() and yields events + final result
    2. A consumer returns early when it sees the final result
    3. Generator cleanup happens in a different context

    This verifies both _AgentStreamWrapper and _DirectStreamWrapper handle
    task context changes correctly.
    """
    from collections.abc import AsyncIterator

    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=100))

    class StreamEvent:
        """Wrapper for stream events."""

        def __init__(self, data, is_final=False):
            self.data = data
            self.is_final = is_final

    async def _agent_stream_wrapper() -> AsyncIterator[StreamEvent]:
        """Async generator that wraps agent streaming."""
        async with agent.run_stream("Count from 1 to 5") as result:
            # Yield text chunks
            async for text in result.stream_text(delta=True):
                yield StreamEvent(data=text, is_final=False)

            # Yield final result after streaming
            # Note: We can't call result.output here as it's consumed during streaming,
            # so we yield a marker for the final event
            yield StreamEvent(data="FINAL", is_final=True)

    async def _consume_until_final() -> StreamEvent:
        """Consumer that returns early when it sees final event.

        This early return causes generator cleanup in different context.
        """
        async for event in _agent_stream_wrapper():
            if event.is_final:
                # Early return - generator cleanup in different context
                return event
        raise RuntimeError("No final event received")

    start = time.time()

    # This should NOT raise ValueError about "different Context"
    result = await _consume_until_final()
    end = time.time()

    # Verify we got the final event
    assert result.is_final
    assert result.data == "FINAL"

    # Check spans - should have created spans despite early generator cleanup
    spans = memory_logger.pop()
    assert len(spans) >= 1, "Should have at least one span"

    # Find agent_run_stream span
    agent_span = next((s for s in spans if "agent_run_stream" in s["span_attributes"]["name"]), None)
    assert agent_span is not None, "agent_run_stream span should exist"
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert "start" in agent_span["metrics"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_binary_content(memory_logger):
    """Test that agents with binary content (images) work correctly.

    Verifies that BinaryContent is properly converted to Braintrust attachments
    in both the agent_run span (parent) and chat span (child).
    """
    from braintrust.logger import Attachment
    from pydantic_ai.models.function import BinaryContent

    assert not memory_logger.pop()

    # Use a small test image (1x1 PNG)
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

    # Check spans - should have both agent_run and chat spans
    spans = memory_logger.pop()
    assert len(spans) >= 2, f"Expected at least 2 spans (agent_run + chat), got {len(spans)}"

    # Find agent_run span (parent)
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"] and "chat" not in s["span_attributes"]["name"]), None)
    assert agent_span is not None, "agent_run span not found"

    # Find chat span (child)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)
    assert chat_span is not None, "chat span not found"

    # Verify basic span structure
    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    _assert_metrics_are_valid(agent_span["metrics"], start, end)

    # CRITICAL: Verify that BOTH spans properly serialize BinaryContent to attachments
    def has_attachment_in_input(span_input):
        """Check if span input contains a Braintrust Attachment object."""
        if not span_input:
            return False

        def check_item(item):
            """Recursively check an item for attachments."""
            if isinstance(item, dict):
                if item.get("type") == "binary" and isinstance(item.get("attachment"), Attachment):
                    return True
                # Check nested content field (for UserPromptPart-like structures)
                if "content" in item:
                    content = item["content"]
                    if isinstance(content, list):
                        for sub_item in content:
                            if check_item(sub_item):
                                return True
            return False

        # Check user_prompt (agent_run span)
        if "user_prompt" in span_input:
            user_prompt = span_input["user_prompt"]
            if isinstance(user_prompt, list):
                for item in user_prompt:
                    if check_item(item):
                        return True

        # Check messages (chat span)
        if "messages" in span_input:
            messages = span_input["messages"]
            if isinstance(messages, list):
                for msg in messages:
                    if isinstance(msg, dict) and "parts" in msg:
                        parts = msg["parts"]
                        if isinstance(parts, list):
                            for part in parts:
                                if check_item(part):
                                    return True

        return False

    # Verify agent_run span has attachment
    agent_has_attachment = has_attachment_in_input(agent_span.get("input", {}))
    assert agent_has_attachment, (
        "agent_run span should have BinaryContent converted to Braintrust Attachment. "
        f"Input: {agent_span.get('input', {})}"
    )

    # Verify chat span has attachment (this is the key test for the bug)
    chat_has_attachment = has_attachment_in_input(chat_span.get("input", {}))
    assert chat_has_attachment, (
        "chat span should have BinaryContent converted to Braintrust Attachment. "
        "The child span should process attachments the same way as the parent. "
        f"Input: {chat_span.get('input', {})}"
    )


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_agent_with_document_input(memory_logger):
    """Test that agents with document input (PDF) properly serialize attachments.

    This specifically tests the scenario from test_document_input in the golden tests,
    verifying that both agent_run and chat spans convert BinaryContent to Braintrust
    attachments for document files like PDFs.
    """
    from braintrust.logger import Attachment
    from pydantic_ai.models.function import BinaryContent

    assert not memory_logger.pop()

    # Create a minimal PDF (this is a valid but minimal PDF structure)
    pdf_data = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj 4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Test Document) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000214 00000 n\ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n307\n%%EOF'

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=150))

    start = time.time()
    result = await agent.run(
        [
            BinaryContent(data=pdf_data, media_type="application/pdf"),
            "What is in this document?",
        ]
    )
    end = time.time()

    assert result.output
    assert isinstance(result.output, str)

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) >= 2, f"Expected at least 2 spans (agent_run + chat), got {len(spans)}"

    # Find spans
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"] and "chat" not in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run span not found"
    assert chat_span is not None, "chat span not found"

    # Helper to check for PDF attachment
    def has_pdf_attachment(span_input):
        """Check if span input contains a PDF Braintrust Attachment."""
        if not span_input:
            return False

        def check_item(item):
            """Recursively check an item for PDF attachments."""
            if isinstance(item, dict):
                if item.get("type") == "binary" and item.get("media_type") == "application/pdf":
                    attachment = item.get("attachment")
                    if isinstance(attachment, Attachment):
                        if attachment._reference.get("content_type") == "application/pdf":
                            return True
                # Check nested content field (for UserPromptPart-like structures)
                if "content" in item:
                    content = item["content"]
                    if isinstance(content, list):
                        for sub_item in content:
                            if check_item(sub_item):
                                return True
            return False

        # Check user_prompt (agent_run span)
        if "user_prompt" in span_input:
            user_prompt = span_input["user_prompt"]
            if isinstance(user_prompt, list):
                for item in user_prompt:
                    if check_item(item):
                        return True

        # Check messages (chat span)
        if "messages" in span_input:
            messages = span_input["messages"]
            if isinstance(messages, list):
                for msg in messages:
                    if isinstance(msg, dict) and "parts" in msg:
                        parts = msg["parts"]
                        if isinstance(parts, list):
                            for part in parts:
                                if check_item(part):
                                    return True

        return False

    # Verify agent_run span has PDF attachment
    assert has_pdf_attachment(agent_span.get("input", {})), (
        "agent_run span should have PDF BinaryContent converted to Braintrust Attachment"
    )

    # Verify chat span has PDF attachment (critical for document input)
    assert has_pdf_attachment(chat_span.get("input", {})), (
        "chat span should have PDF BinaryContent converted to Braintrust Attachment. "
        "This ensures documents are properly traced in the low-level model call. "
        f"Chat span input: {chat_span.get('input', {})}"
    )

    # Verify metrics
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


@pytest.mark.vcr
def test_tool_execution_creates_spans(memory_logger):
    """Test that executing tools with agents works and creates traced spans.

    Note: Tool-level span creation is not yet implemented in the wrapper.
    This test verifies that agents with tools work correctly and produce agent/chat spans.

    Future enhancement: Add automatic span creation for tool executions as children of
    the chat span that requested them.
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

    # Verify the tool was actually called and result is correct
    assert result.output
    assert "6223" in str(result.output) or "6,223" in str(result.output), f"Expected calculation result in output: {result.output}"

    # Get logged spans
    spans = memory_logger.pop()

    # Find spans by type
    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"]), None)
    chat_spans = [s for s in spans if "chat" in s["span_attributes"]["name"]]

    # Assertions - verify basic tracing works with tools
    assert agent_span is not None, "agent_run span should exist"
    assert len(chat_spans) >= 1, f"Expected at least 1 chat span, got {len(chat_spans)}"

    # Verify agent span has tool information in input
    assert "toolsets" in agent_span["input"], "Tool information should be captured in agent input"
    toolsets = agent_span["input"]["toolsets"]
    agent_toolset = next((ts for ts in toolsets if ts.get("id") == "<agent>"), None)
    assert agent_toolset is not None, "Agent toolset should be in input"

    # Verify calculate tool is in the toolset
    tools = agent_toolset.get("tools", [])
    tool_names = [t["name"] for t in tools if isinstance(t, dict)]
    assert "calculate" in tool_names, f"calculate tool should be in toolset, got: {tool_names}"

    # TODO: Future enhancement - verify tool execution spans are created
    # tool_spans = [s for s in spans if "calculate" in s["span_attributes"].get("name", "")]
    # assert len(tool_spans) > 0, "Tool execution should create spans"


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
    # pylint: disable=unsupported-membership-test,unsubscriptable-object
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
    # pylint: enable=unsupported-membership-test,unsubscriptable-object


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


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_model_class_span_names(memory_logger):
    """Test that model class spans have proper names.

    Verifies that the nested chat span from the model class wrapper has a
    meaningful name (either the model name or class name), not a misleading
    string like 'log'.

    This test ensures that when model_name is None, we fall back to the
    class name (e.g., 'OpenAIChatModel') rather than str(instance) which
    could return unexpected values.
    """
    assert not memory_logger.pop()

    agent = Agent(MODEL, model_settings=ModelSettings(max_tokens=50))

    start = time.time()
    result = await agent.run("What is 2+2?")
    end = time.time()

    assert result.output

    # Check spans
    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    # Find chat span (the nested model class span)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)
    assert chat_span is not None, "chat span not found"

    span_name = chat_span["span_attributes"]["name"]

    # Verify the span name is meaningful
    # It should be either "chat <model_name>" or "chat <ClassName>"
    # but NOT "chat log" or other misleading names
    assert span_name.startswith("chat "), f"Chat span should start with 'chat ', got: {span_name}"

    # Extract the model/class identifier part after "chat "
    identifier = span_name[5:]  # Skip "chat "

    # Should not be empty or misleading values
    assert identifier, "Chat span should have a model name or class name after 'chat '"
    assert identifier != "log", "Chat span should not be named 'log' - should use model name or class name"
    assert len(identifier) > 2, f"Chat span identifier seems too short: {identifier}"

    # Common valid patterns:
    # - "chat gpt-4o-mini" (model name extracted)
    # - "chat OpenAIChatModel" (class name fallback)
    # - "chat gpt-4o" (model name)
    valid_patterns = [
        "gpt-" in identifier,  # OpenAI model names
        "claude" in identifier.lower(),  # Anthropic models
        "Model" in identifier,  # Class name fallback (e.g., OpenAIChatModel)
        "-" in identifier,  # Model names typically have hyphens
    ]

    assert any(valid_patterns), (
        f"Chat span name '{span_name}' doesn't match expected patterns. "
        f"Should contain model name (e.g., 'gpt-4o-mini') or class name (e.g., 'OpenAIChatModel')"
    )

    # Verify span has proper structure
    assert chat_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
    _assert_metrics_are_valid(chat_span["metrics"], start, end)


def test_serialize_content_part_with_binary_content():
    """Unit test to verify _serialize_content_part handles BinaryContent correctly.

    This tests the direct serialization of BinaryContent objects and verifies
    they are converted to Braintrust Attachment objects.
    """
    from braintrust.logger import Attachment
    from braintrust.wrappers.pydantic_ai import _serialize_content_part
    from pydantic_ai.models.function import BinaryContent

    # Test 1: Direct BinaryContent serialization
    binary = BinaryContent(data=b"test pdf data", media_type="application/pdf")
    result = _serialize_content_part(binary)

    assert result is not None, "Should serialize BinaryContent"
    assert result["type"] == "binary", "Should have type 'binary'"
    assert result["media_type"] == "application/pdf", "Should preserve media_type"
    assert isinstance(result["attachment"], Attachment), "Should convert to Braintrust Attachment"

    # Verify attachment has correct content_type
    assert result["attachment"]._reference["content_type"] == "application/pdf"


def test_serialize_content_part_with_user_prompt_part():
    """Unit test to verify _serialize_content_part handles UserPromptPart with nested BinaryContent.

    This is the critical test for the bug: when a UserPromptPart has a content list
    containing BinaryContent, we need to recursively serialize the content items
    so that BinaryContent is converted to Braintrust Attachment.
    """
    from braintrust.logger import Attachment
    from braintrust.wrappers.pydantic_ai import _serialize_content_part
    from pydantic_ai.messages import UserPromptPart
    from pydantic_ai.models.function import BinaryContent

    # Create a UserPromptPart with mixed content (BinaryContent + string)
    pdf_data = b"%PDF-1.4 test document content"
    binary = BinaryContent(data=pdf_data, media_type="application/pdf")
    user_prompt_part = UserPromptPart(content=[binary, "What is in this document?"])

    # Serialize the UserPromptPart
    result = _serialize_content_part(user_prompt_part)

    # Verify the result is a dict with serialized content
    assert isinstance(result, dict), f"Should return dict, got {type(result)}"
    assert "content" in result, f"Should have 'content' key. Keys: {result.keys()}"

    content = result["content"]
    assert isinstance(content, list), f"Content should be a list, got {type(content)}"
    assert len(content) == 2, f"Should have 2 content items, got {len(content)}"

    # CRITICAL: First item should be serialized BinaryContent with Attachment
    binary_item = content[0]
    assert isinstance(binary_item, dict), f"Binary item should be dict, got {type(binary_item)}"
    assert binary_item.get("type") == "binary", (
        f"Binary item should have type='binary'. Got: {binary_item}"
    )
    assert "attachment" in binary_item, (
        f"Binary item should have 'attachment' key. Keys: {binary_item.keys()}"
    )
    assert isinstance(binary_item["attachment"], Attachment), (
        f"Should be Braintrust Attachment, got {type(binary_item.get('attachment'))}"
    )
    assert binary_item["media_type"] == "application/pdf"

    # Second item should be the string
    assert content[1] == "What is in this document?"


def test_serialize_messages_with_binary_content():
    """Unit test to verify _serialize_messages handles ModelRequest with BinaryContent in parts.

    This tests the full message serialization path that's used for the chat span,
    ensuring that nested BinaryContent in UserPromptPart is properly converted.
    """
    from braintrust.logger import Attachment
    from braintrust.wrappers.pydantic_ai import _serialize_messages
    from pydantic_ai.messages import ModelRequest, UserPromptPart
    from pydantic_ai.models.function import BinaryContent

    # Create a ModelRequest with UserPromptPart containing BinaryContent
    pdf_data = b"%PDF-1.4 test document content"
    binary = BinaryContent(data=pdf_data, media_type="application/pdf")
    user_prompt_part = UserPromptPart(content=[binary, "What is in this document?"])
    model_request = ModelRequest(parts=[user_prompt_part])

    # Serialize the messages
    messages = [model_request]
    result = _serialize_messages(messages)

    # Verify structure
    assert len(result) == 1, f"Should have 1 message, got {len(result)}"
    msg = result[0]
    assert "parts" in msg, f"Message should have 'parts'. Keys: {msg.keys()}"

    parts = msg["parts"]
    assert len(parts) == 1, f"Should have 1 part, got {len(parts)}"

    part = parts[0]
    assert isinstance(part, dict), f"Part should be dict, got {type(part)}"
    assert "content" in part, f"Part should have 'content'. Keys: {part.keys()}"

    content = part["content"]
    assert isinstance(content, list), f"Content should be list, got {type(content)}"
    assert len(content) == 2, f"Should have 2 content items, got {len(content)}"

    # CRITICAL: First content item should be serialized BinaryContent with Attachment
    binary_item = content[0]
    assert isinstance(binary_item, dict), f"Binary item should be dict, got {type(binary_item)}"
    assert binary_item.get("type") == "binary", (
        f"Binary item should have type='binary'. Got: {binary_item}"
    )
    assert "attachment" in binary_item, (
        f"Binary item should have 'attachment'. Keys: {binary_item.keys()}"
    )
    assert isinstance(binary_item["attachment"], Attachment), (
        f"Should be Braintrust Attachment, got {type(binary_item.get('attachment'))}"
    )
    assert binary_item["media_type"] == "application/pdf"

    # Second content item should be the string
    assert content[1] == "What is in this document?"


@pytest.mark.asyncio
async def test_streaming_wrappers_capture_time_to_first_token():
    """Unit test verifying all streaming wrappers capture time_to_first_token.

    This test uses mocks to verify the internal wrapper logic without requiring
    API calls. It ensures that _first_token_time is tracked correctly in:
    - _AgentStreamWrapper (async agent streaming)
    - _DirectStreamWrapper (async direct API streaming)
    - _AgentStreamResultSyncProxy (sync agent streaming)
    - _DirectStreamWrapperSync (sync direct API streaming)
    """
    from unittest.mock import AsyncMock, MagicMock, Mock

    from braintrust.wrappers.pydantic_ai import (
        _AgentStreamResultSyncProxy,
        _AgentStreamWrapper,
        _DirectStreamIteratorProxy,
        _DirectStreamIteratorSyncProxy,
        _DirectStreamWrapper,
        _DirectStreamWrapperSync,
        _StreamResultProxy,
    )

    # Test 1: _AgentStreamWrapper captures first token time
    print("\n--- Testing _AgentStreamWrapper ---")

    class MockStreamResult:
        async def stream_text(self, delta=True):
            for i in range(3):
                await asyncio.sleep(0.001)
                yield f"token{i} "

        def usage(self):
            usage_mock = Mock(input_tokens=50, output_tokens=20, total_tokens=70)
            usage_mock.cache_read_tokens = None
            usage_mock.cache_write_tokens = None
            return usage_mock

    mock_stream_result = MockStreamResult()
    wrapper = _AgentStreamWrapper(
        stream_cm=AsyncMock(),
        span_name="test_stream",
        input_data={"prompt": "test"},
        metadata={"model": "gpt-4o"},
    )

    wrapper.span_cm = MagicMock()
    wrapper.span_cm.__enter__ = MagicMock()
    wrapper.start_time = time.time()
    wrapper.stream_result = mock_stream_result

    proxy = _StreamResultProxy(mock_stream_result, wrapper)

    assert wrapper._first_token_time is None

    chunk_count = 0
    async for text in proxy.stream_text(delta=True):
        chunk_count += 1
        if chunk_count == 1:
            assert wrapper._first_token_time is not None
            assert wrapper._first_token_time > wrapper.start_time

    assert chunk_count == 3
    assert wrapper._first_token_time is not None
    print("✓ _AgentStreamWrapper captures first token time")

    # Test 2: _DirectStreamWrapper captures first token time
    print("\n--- Testing _DirectStreamWrapper ---")

    class MockStream:
        def __init__(self):
            self.chunks = []

        async def __anext__(self):
            if len(self.chunks) < 3:
                await asyncio.sleep(0.001)
                chunk = Mock(delta=Mock(content_delta=f"chunk{len(self.chunks)}"))
                self.chunks.append(chunk)
                return chunk
            raise StopAsyncIteration

        def __aiter__(self):
            return self

        def get(self):
            usage_mock = Mock(input_tokens=50, output_tokens=20, total_tokens=70)
            usage_mock.cache_read_tokens = None
            usage_mock.cache_write_tokens = None
            return Mock(usage=usage_mock)

    mock_stream = MockStream()
    direct_wrapper = _DirectStreamWrapper(
        stream_cm=AsyncMock(),
        span_name="test_direct_stream",
        input_data={"messages": []},
        metadata={"model": "gpt-4o"},
    )

    direct_wrapper.span_cm = MagicMock()
    direct_wrapper.start_time = time.time()
    direct_wrapper.stream = mock_stream

    proxy = _DirectStreamIteratorProxy(mock_stream, direct_wrapper)

    assert direct_wrapper._first_token_time is None

    chunk_count = 0
    async for chunk in proxy:
        chunk_count += 1
        if chunk_count == 1:
            assert direct_wrapper._first_token_time is not None
            assert direct_wrapper._first_token_time > direct_wrapper.start_time

    assert chunk_count == 3
    assert direct_wrapper._first_token_time is not None
    print("✓ _DirectStreamWrapper captures first token time")

    # Test 3: _AgentStreamResultSyncProxy captures first token time
    print("\n--- Testing _AgentStreamResultSyncProxy ---")

    class MockSyncStreamResult:
        def stream_text(self, delta=True):
            for i in range(3):
                time.sleep(0.001)
                yield f"token{i} "

        def usage(self):
            usage_mock = Mock(input_tokens=50, output_tokens=20, total_tokens=70)
            usage_mock.cache_read_tokens = None
            usage_mock.cache_write_tokens = None
            return usage_mock

    mock_sync_result = MockSyncStreamResult()
    sync_proxy = _AgentStreamResultSyncProxy(
        stream_result=mock_sync_result,
        span=MagicMock(),
        span_cm=MagicMock(),
        start_time=time.time(),
    )

    assert sync_proxy._first_token_time is None

    chunk_count = 0
    for text in sync_proxy.stream_text(delta=True):
        chunk_count += 1
        if chunk_count == 1:
            assert sync_proxy._first_token_time is not None

    assert chunk_count == 3
    assert sync_proxy._first_token_time is not None
    print("✓ _AgentStreamResultSyncProxy captures first token time")

    # Test 4: _DirectStreamWrapperSync captures first token time
    print("\n--- Testing _DirectStreamWrapperSync ---")

    class MockSyncStream:
        def __init__(self):
            self.chunks = []

        def __iter__(self):
            return self

        def __next__(self):
            if len(self.chunks) < 3:
                time.sleep(0.001)
                chunk = Mock(delta=Mock(content_delta=f"chunk{len(self.chunks)}"))
                self.chunks.append(chunk)
                return chunk
            raise StopIteration

        def get(self):
            usage_mock = Mock(input_tokens=50, output_tokens=20, total_tokens=70)
            usage_mock.cache_read_tokens = None
            usage_mock.cache_write_tokens = None
            return Mock(usage=usage_mock)

    mock_sync_stream = MockSyncStream()
    sync_wrapper = _DirectStreamWrapperSync(
        stream_cm=MagicMock(),
        span_name="test_sync_stream",
        input_data={"messages": []},
        metadata={"model": "gpt-4o"},
    )

    sync_wrapper.start_time = time.time()
    sync_wrapper.stream = mock_sync_stream

    sync_proxy = _DirectStreamIteratorSyncProxy(mock_sync_stream, sync_wrapper)

    assert sync_wrapper._first_token_time is None

    chunk_count = 0
    for chunk in sync_proxy:
        chunk_count += 1
        if chunk_count == 1:
            assert sync_wrapper._first_token_time is not None
            assert sync_wrapper._first_token_time > sync_wrapper.start_time

    assert chunk_count == 3
    assert sync_wrapper._first_token_time is not None
    print("✓ _DirectStreamWrapperSync captures first token time")

    print("\n✅ All streaming wrapper unit tests passed!")


@pytest.mark.asyncio
async def test_attachment_preserved_in_model_settings(memory_logger):
    """Test that attachments in model_settings are preserved through serialization."""
    from braintrust.bt_json import bt_safe_deep_copy
    from braintrust.logger import Attachment

    attachment = Attachment(data=b"config data", filename="config.txt", content_type="text/plain")

    # Simulate model_settings with attachment
    settings = {"temperature": 0.7, "context_file": attachment}

    # Test bt_safe_deep_copy preserves attachment
    copied = bt_safe_deep_copy(settings)
    assert copied["context_file"] is attachment
    assert copied["temperature"] == 0.7


@pytest.mark.asyncio
async def test_attachment_in_message_part(memory_logger):
    """Test that attachment in custom message part is preserved."""
    from braintrust.bt_json import bt_safe_deep_copy
    from braintrust.logger import Attachment

    attachment = Attachment(data=b"message data", filename="msg.txt", content_type="text/plain")

    # Simulate message part with attachment
    message_part = {"type": "file", "content": attachment, "metadata": {"source": "upload"}}

    copied = bt_safe_deep_copy(message_part)
    assert copied["content"] is attachment
    assert copied["type"] == "file"


@pytest.mark.asyncio
async def test_attachment_in_result_data(memory_logger):
    """Test that attachment in custom result data is preserved."""
    from braintrust.bt_json import bt_safe_deep_copy
    from braintrust.logger import ExternalAttachment

    ext_attachment = ExternalAttachment(
        url="s3://bucket/result.pdf", filename="result.pdf", content_type="application/pdf"
    )

    # Simulate agent result with attachment
    result_data = {"success": True, "output_file": ext_attachment, "metadata": {"processed": True}}

    copied = bt_safe_deep_copy(result_data)
    assert copied["output_file"] is ext_attachment
    assert copied["success"] is True


class TestAutoInstrumentPydanticAI:
    """Tests for auto_instrument() with Pydantic AI."""

    def test_auto_instrument_pydantic_ai(self):
        """Test auto_instrument patches Pydantic AI and creates spans."""
        verify_autoinstrument_script("test_auto_pydantic_ai.py")
