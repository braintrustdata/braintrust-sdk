"""
Integration tests for the Claude Agent SDK wrapper.

These tests verify the wrapper creates the correct span hierarchy when used with
the actual Claude Agent SDK.
"""

import pytest

# Try to import the Claude Agent SDK - skip tests if not available
try:
    import claude_agent_sdk

    CLAUDE_SDK_AVAILABLE = True
except ImportError:
    CLAUDE_SDK_AVAILABLE = False
    print("Claude Agent SDK not installed, skipping integration tests")

from braintrust import logger
from braintrust.span_types import SpanTypeAttribute
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.claude_agent_sdk._wrapper import (
    _create_client_wrapper_class,
    _create_tool_wrapper_class,
)
from braintrust.wrappers.test_utils import verify_autoinstrument_script

PROJECT_NAME = "test-claude-agent-sdk"
TEST_MODEL = "claude-haiku-4-5-20251001"


@pytest.fixture
def memory_logger():
    """Memory-based logger for testing span creation."""
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


@pytest.mark.skipif(not CLAUDE_SDK_AVAILABLE, reason="Claude Agent SDK not installed")
@pytest.mark.asyncio
async def test_calculator_with_multiple_operations(memory_logger):
    """Test claude_agent.py example - calculator with multiple operations.

    This integration test verifies:
    - Task span is created for the overall agent interaction
    - LLM spans are created for each message group
    - Tool spans are created for calculator calls
    - Span hierarchy is correct (children reference parent)
    - Metrics are properly extracted and logged
    """
    assert not memory_logger.pop()

    # Patch claude_agent_sdk for tracing (logger already initialized by fixture)
    original_client = claude_agent_sdk.ClaudeSDKClient
    original_tool_class = claude_agent_sdk.SdkMcpTool

    claude_agent_sdk.ClaudeSDKClient = _create_client_wrapper_class(original_client)
    claude_agent_sdk.SdkMcpTool = _create_tool_wrapper_class(original_tool_class)

    # Create calculator tool
    async def calculator_handler(args):
        operation = args["operation"]
        a = args["a"]
        b = args["b"]

        if operation == "multiply":
            result = a * b
        elif operation == "subtract":
            result = a - b
        elif operation == "add":
            result = a + b
        elif operation == "divide":
            if b == 0:
                return {
                    "content": [{"type": "text", "text": "Error: Division by zero"}],
                    "isError": True,
                }
            result = a / b
        else:
            return {
                "content": [{"type": "text", "text": f"Unknown operation: {operation}"}],
                "isError": True,
            }

        return {
            "content": [{"type": "text", "text": f"The result of {operation}({a}, {b}) is {result}"}],
        }

    calculator_tool = claude_agent_sdk.SdkMcpTool(
        name="calculator",
        description="Performs basic arithmetic operations",
        input_schema={
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["add", "subtract", "multiply", "divide"],
                    "description": "The arithmetic operation to perform",
                },
                "a": {"type": "number", "description": "First number"},
                "b": {"type": "number", "description": "Second number"},
            },
            "required": ["operation", "a", "b"],
        },
        handler=calculator_handler,
    )

    # Run the query using ClaudeSDKClient (required for tracing)
    options = claude_agent_sdk.ClaudeAgentOptions(
        model=TEST_MODEL,
        mcp_servers={
            "calculator": claude_agent_sdk.create_sdk_mcp_server(
                name="calculator",
                version="1.0.0",
                tools=[calculator_tool],
            )
        },
    )

    result_message = None
    async with claude_agent_sdk.ClaudeSDKClient(options=options) as client:
        await client.query("What is 15 multiplied by 7? Then subtract 5 from the result.")
        async for message in client.receive_response():
            # Check for ResultMessage by class name
            if type(message).__name__ == "ResultMessage":
                result_message = message

    # Get logged spans
    spans = memory_logger.pop()

    # Verify root task span
    task_spans = [s for s in spans if s["span_attributes"]["type"] == SpanTypeAttribute.TASK]
    assert len(task_spans) == 1, f"Should have exactly one task span, got {len(task_spans)}"

    task_span = task_spans[0]
    assert task_span["span_attributes"]["name"] == "Claude Agent"
    assert "15 multiplied by 7" in task_span["input"]
    assert task_span["output"] is not None

    # Verify we received result message with metadata
    assert result_message is not None, "Should have received result message"
    if hasattr(result_message, "num_turns"):
        assert task_span.get("metadata", {}).get("num_turns") is not None
    if hasattr(result_message, "session_id"):
        assert task_span.get("metadata", {}).get("session_id") is not None

    # Verify LLM spans (multiple anthropic.messages.create calls)
    llm_spans = [s for s in spans if s["span_attributes"]["type"] == SpanTypeAttribute.LLM]
    assert len(llm_spans) >= 1, f"Should have at least one LLM span, got {len(llm_spans)}"

    # Check that at least one LLM span has token metrics
    llm_spans_with_metrics = [s for s in llm_spans if "prompt_tokens" in s.get("metrics", {})]
    assert len(llm_spans_with_metrics) >= 1, "At least one LLM span should have token metrics"

    for llm_span in llm_spans:
        assert llm_span["span_attributes"]["name"] == "anthropic.messages.create"
        # Output should be an array of messages
        assert isinstance(llm_span["output"], list)
        assert len(llm_span["output"]) > 0

    # Verify the last LLM span has complete metrics
    last_llm_span = llm_spans[-1]
    assert last_llm_span["metrics"]["prompt_tokens"] > 0
    assert last_llm_span["metrics"]["completion_tokens"] > 0

    # Verify tool spans (calculator may or may not be called depending on model behavior)
    tool_spans = [s for s in spans if s["span_attributes"]["type"] == SpanTypeAttribute.TOOL]

    for tool_span in tool_spans:
        assert tool_span["span_attributes"]["name"] == "calculator"
        assert tool_span["input"] is not None
        assert tool_span["output"] is not None

    # Verify span hierarchy (all children should reference the root task span)
    root_span_id = task_span["span_id"]
    for span in spans:
        if span["span_id"] != root_span_id:
            assert span["root_span_id"] == root_span_id
            assert root_span_id in span["span_parents"]


def _make_message(content: str) -> dict:
    """Create a streaming format message dict."""
    return {"type": "user", "message": {"role": "user", "content": content}}


def _assert_structured_input(task_span: dict, expected_contents: list[str]) -> None:
    """Assert that task span input is a structured list with expected content."""
    inp = task_span.get("input")
    assert isinstance(inp, list), f"Expected list input, got {type(inp).__name__}: {inp}"
    assert [x["message"]["content"] for x in inp] == expected_contents


class CustomAsyncIterable:
    """Custom AsyncIterable class (not a generator) for testing."""

    def __init__(self, messages: list[dict]):
        self._messages = messages

    def __aiter__(self):
        return CustomAsyncIterator(self._messages)


class CustomAsyncIterator:
    """Iterator for CustomAsyncIterable."""

    def __init__(self, messages: list[dict]):
        self._messages = messages
        self._index = 0

    async def __anext__(self):
        if self._index >= len(self._messages):
            raise StopAsyncIteration
        msg = self._messages[self._index]
        self._index += 1
        return msg


@pytest.mark.skipif(not CLAUDE_SDK_AVAILABLE, reason="Claude Agent SDK not installed")
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "input_factory,expected_contents",
    [
        pytest.param(
            lambda: (msg async for msg in _single_message_generator()),
            ["What is 2 + 2?"],
            id="asyncgen_single",
        ),
        pytest.param(
            lambda: (msg async for msg in _multi_message_generator()),
            ["Part 1", "Part 2"],
            id="asyncgen_multi",
        ),
        pytest.param(
            lambda: CustomAsyncIterable([_make_message("Custom 1"), _make_message("Custom 2")]),
            ["Custom 1", "Custom 2"],
            id="custom_async_iterable",
        ),
    ],
)
async def test_query_async_iterable(memory_logger, input_factory, expected_contents):
    """Test that async iterable inputs are captured as structured lists.

    Verifies that passing AsyncIterable[dict] to query() results in the span
    input showing the structured message list, not a flattened string or repr.
    """
    assert not memory_logger.pop()

    original_client = claude_agent_sdk.ClaudeSDKClient
    claude_agent_sdk.ClaudeSDKClient = _create_client_wrapper_class(original_client)

    try:
        options = claude_agent_sdk.ClaudeAgentOptions(model=TEST_MODEL)

        async with claude_agent_sdk.ClaudeSDKClient(options=options) as client:
            await client.query(input_factory())
            async for message in client.receive_response():
                if type(message).__name__ == "ResultMessage":
                    break

        spans = memory_logger.pop()

        task_spans = [s for s in spans if s["span_attributes"]["type"] == SpanTypeAttribute.TASK]
        assert len(task_spans) >= 1, f"Should have at least one task span, got {len(task_spans)}"

        task_span = next(
            (s for s in task_spans if s["span_attributes"]["name"] == "Claude Agent"),
            task_spans[0],
        )

        _assert_structured_input(task_span, expected_contents)

    finally:
        claude_agent_sdk.ClaudeSDKClient = original_client


async def _single_message_generator():
    """Generator yielding a single message."""
    yield _make_message("What is 2 + 2?")


async def _multi_message_generator():
    """Generator yielding multiple messages."""
    yield _make_message("Part 1")
    yield _make_message("Part 2")


class TestAutoInstrumentClaudeAgentSDK:
    """Tests for auto_instrument() with Claude Agent SDK."""

    def test_auto_instrument_claude_agent_sdk(self):
        """Test auto_instrument patches Claude Agent SDK and creates spans."""
        verify_autoinstrument_script("test_auto_claude_agent_sdk.py")
