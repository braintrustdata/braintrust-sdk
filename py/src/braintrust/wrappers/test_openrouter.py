"""
Tests to ensure wrap_openai works correctly with OpenRouter.

OpenRouter is a popular API gateway that provides access to multiple LLM providers
through an OpenAI-compatible interface. This test validates that our wrapper handles
OpenRouter-specific response fields correctly (e.g., boolean `is_byok` in usage).
"""

import os
import time

import pytest
from braintrust import logger, wrap_openai
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.test_utils import assert_metrics_are_valid
from openai import AsyncOpenAI, OpenAI

PROJECT_NAME = "test-openrouter"
TEST_MODEL = "openai/gpt-4o-mini"


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


def _get_client():
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ.get("OPENROUTER_API_KEY"),
    )


def _get_async_client():
    return AsyncOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ.get("OPENROUTER_API_KEY"),
    )


@pytest.mark.vcr
def test_openrouter_chat_completion_sync(memory_logger):
    assert not memory_logger.pop()

    client = wrap_openai(_get_client())

    start = time.time()
    response = client.chat.completions.create(
        model=TEST_MODEL,
        messages=[{"role": "user", "content": "What is 2+2? Reply with just the number."}],
        max_tokens=10,
    )
    end = time.time()

    assert response
    assert response.choices[0].message.content
    assert "4" in response.choices[0].message.content

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]

    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)

    # Ensure no boolean values in metrics (the original bug with is_byok)
    for key, value in metrics.items():
        assert not isinstance(value, bool), f"Metric {key} should not be a boolean"


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_openrouter_chat_completion_async(memory_logger):
    """Test that wrap_openai works with OpenRouter's async client."""
    assert not memory_logger.pop()

    client = wrap_openai(_get_async_client())

    start = time.time()
    response = await client.chat.completions.create(
        model=TEST_MODEL,
        messages=[{"role": "user", "content": "What is 3+3? Reply with just the number."}],
        max_tokens=10,
    )
    end = time.time()

    assert response
    assert response.choices[0].message.content
    assert "6" in response.choices[0].message.content

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]

    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)

    for key, value in metrics.items():
        assert not isinstance(value, bool), f"Metric {key} should not be a boolean"


@pytest.mark.vcr
def test_openrouter_streaming_sync(memory_logger):
    """Test that wrap_openai works with OpenRouter's streaming responses."""
    assert not memory_logger.pop()

    client = wrap_openai(_get_client())

    start = time.time()
    chunks = []
    stream = client.chat.completions.create(
        model=TEST_MODEL,
        messages=[{"role": "user", "content": "What is 5+5? Reply with just the number."}],
        max_tokens=10,
        stream=True,
    )
    for chunk in stream:
        chunks.append(chunk)
    end = time.time()

    assert chunks
    content = "".join(c.choices[0].delta.content or "" for c in chunks if c.choices)
    assert "10" in content

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]

    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)

    for key, value in metrics.items():
        assert not isinstance(value, bool), f"Metric {key} should not be a boolean"
