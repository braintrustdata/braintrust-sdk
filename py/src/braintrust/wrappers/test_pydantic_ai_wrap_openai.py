import time
from typing import Any, Dict

import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent  # pylint: disable=import-error

try:
    # Try new API first (pydantic_ai >= 1.0)
    from pydantic_ai.models.openai import OpenAIChatModel  # pylint: disable=import-error

    OpenAIModelClass = OpenAIChatModel
except ImportError:
    # Fall back to old API (pydantic_ai < 1.0)
    from pydantic_ai.models.openai import OpenAIModel  # pylint: disable=import-error

    OpenAIModelClass = OpenAIModel
from braintrust import logger, wrap_openai
from braintrust.span_types import SpanTypeAttribute
from braintrust.test_helpers import init_test_logger
from pydantic_ai.providers.openai import OpenAIProvider  # pylint: disable=import-error

PROJECT_NAME = "test-pydantic-ai"
MODEL = "gpt-3.5-turbo"  # Use a cheaper model for testing
TEST_PROMPT = "What is the capital of Italy?"


def get_pydantic_agents_client(model_name: str, client: AsyncOpenAI):
    _provider = OpenAIProvider(openai_client=client)
    return OpenAIModelClass(model_name, provider=_provider)


async def _run_prompt_streaming(client: AsyncOpenAI, prompt: str):
    model = get_pydantic_agents_client(MODEL, client=client)
    agent = Agent(model=model)
    result_text = ""
    async with agent.run_stream(prompt) as result:
        # Use stream_output if available (pydantic_ai >= 1.0), otherwise use stream
        if hasattr(result, "stream_output"):
            async for text in result.stream_output(debounce_by=0.01):
                result_text = text
        else:
            async for text in result.stream(debounce_by=0.01):
                result_text = text
    return result_text


async def _run_prompt_completion(client: AsyncOpenAI, prompt: str):
    model = get_pydantic_agents_client(MODEL, client=client)
    agent = Agent(model=model)
    result = await agent.run(prompt)
    return result.output  # Return the string output


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


def _assert_metrics_are_valid(metrics: Dict[str, Any]):
    assert metrics["tokens"] > 0
    assert metrics["prompt_tokens"] > 0
    assert metrics["completion_tokens"] > 0
    assert "time_to_first_token" in metrics


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_pydantic_wrapped_stream(memory_logger):
    """Test that Pydantic AI streaming operations work with Braintrust wrapping."""
    assert not memory_logger.pop()

    # First, verify pure Pydantic AI client works as expected (without wrapping)
    async_client = AsyncOpenAI()
    pure_output = await _run_prompt_streaming(async_client, TEST_PROMPT)
    assert "Rome" in pure_output

    # No spans should be created for unwrapped client
    assert not memory_logger.pop(), "No spans created"

    # Now test the wrapped client
    start = time.time()
    wrapped_output = await _run_prompt_streaming(wrap_openai(async_client), TEST_PROMPT)
    end = time.time()

    # Verify output is still correct with wrapping
    assert "Rome" in wrapped_output

    spans = memory_logger.pop()

    assert len(spans) == 1

    span = spans[0]
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert "name" in span["span_attributes"]
    assert MODEL in str(span["metadata"])
    assert TEST_PROMPT in str(span["input"])
    assert "Rome" in str(span["output"])

    # Verify timing
    metrics = span["metrics"]
    _assert_metrics_are_valid(metrics)
    assert start <= metrics["start"] <= metrics["end"] <= end

    # Verify span relationships
    assert span["span_id"]
    assert span["root_span_id"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_pydantic_wrapped_completion(memory_logger):
    """Test that Pydantic AI completion operations work with Braintrust wrapping."""
    # Clear any previous logs
    assert not memory_logger.pop()

    # First, verify pure Pydantic AI client works as expected (without wrapping)
    async_client = AsyncOpenAI()
    pure_output = await _run_prompt_completion(async_client, TEST_PROMPT)
    assert "Rome" in pure_output

    # No spans should be created for unwrapped client
    assert not memory_logger.pop(), "No spans created"

    # Now test the wrapped client
    start = time.time()
    wrapped_output = await _run_prompt_completion(wrap_openai(async_client), TEST_PROMPT)
    end = time.time()

    # Verify output is still correct with wrapping
    assert "Rome" in wrapped_output

    # Check the spans were created with wrapped client
    spans = memory_logger.pop()

    assert len(spans) == 1

    span = spans[0]
    assert span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert "name" in span["span_attributes"]
    assert MODEL in str(span["metadata"])
    assert TEST_PROMPT in str(span["input"])
    assert "Rome" in str(span["output"])
    metrics = span["metrics"]
    _assert_metrics_are_valid(metrics)
    assert start <= metrics["start"] <= metrics["end"] <= end

    assert span["span_id"]
    assert span["root_span_id"]
