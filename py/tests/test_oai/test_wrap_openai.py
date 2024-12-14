import json
import logging
from inspect import iscoroutinefunction
from typing import TYPE_CHECKING

import httpx
import openai
import pytest
from braintrust.oai import wrap_openai
from openai.types import CompletionUsage
from openai.types.chat import ChatCompletion
from openai.types.chat.chat_completion import ChatCompletionMessage, Choice

if TYPE_CHECKING:
    reveal_type = print  # For type checking only
else:

    def reveal_type(obj):
        pass  # No-op at runtime


logging.basicConfig(level=logging.DEBUG)


@pytest.fixture
def openai_client():
    return openai.OpenAI(api_key="sk-test", base_url="https://api.openai.com/v1/")


@pytest.fixture
def mock_completion():
    return {
        "id": "test-id",
        "object": "chat.completion",
        "created": 1677652288,
        "model": "gpt-3.5-turbo",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "Hello, how can I help you?"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
    }


@pytest.fixture
def setup_responses(mock_completion, httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.openai.com/v1/chat/completions",
        json=mock_completion,
        headers={"Content-Type": "application/json"},
        status_code=200,
    )
    return httpx_mock


def test_wrap_openai_sync_types(openai_client):
    wrapped = wrap_openai(openai_client)
    reveal_type(wrapped)  # type: ignore  # Expected type: openai.OpenAI
    reveal_type(wrapped.chat.completions)  # type: ignore  # Expected type: openai.resources.chat.completions.Completions
    assert hasattr(wrapped.chat.completions, "create")
    assert not hasattr(wrapped.chat.completions, "acreate")


@pytest.mark.asyncio
async def test_wrap_openai_async_types():
    async_client = openai.AsyncOpenAI(
        api_key="sk-test", base_url="https://api.openai.com/v1/", default_headers={"OpenAI-Version": "2020-10-01"}
    )
    wrapped = wrap_openai(async_client)
    reveal_type(wrapped)  # type: ignore  # Expected type: openai.AsyncOpenAI
    reveal_type(wrapped.chat.completions)  # type: ignore  # Expected type: openai.resources.chat.completions.AsyncCompletions
    assert hasattr(wrapped.chat.completions, "create")
    assert iscoroutinefunction(wrapped.chat.completions.create)


def test_wrap_openai_sync_response_types(openai_client, mock_completion, setup_responses):
    wrapped = wrap_openai(openai_client)
    response = wrapped.chat.completions.create(model="gpt-3.5-turbo", messages=[{"role": "user", "content": "Hello"}])
    reveal_type(response)  # type: ignore  # Expected type: openai.types.chat.ChatCompletion
    reveal_type(response.choices[0])  # type: ignore  # Expected type: openai.types.chat.chat_completion.Choice
    reveal_type(response.usage)  # type: ignore  # Expected type: openai.types.completion_usage.CompletionUsage
    assert isinstance(response, ChatCompletion)
    assert isinstance(response.choices[0], Choice)
    assert isinstance(response.usage, CompletionUsage)


@pytest.mark.asyncio
async def test_wrap_openai_async_response_types(mock_completion, setup_responses):
    async_client = openai.AsyncOpenAI(api_key="sk-test", base_url="https://api.openai.com/v1/")
    wrapped = wrap_openai(async_client)
    response = await wrapped.chat.completions.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": "Hello"}]
    )
    reveal_type(response)  # type: ignore  # Expected type: openai.types.chat.ChatCompletion
    reveal_type(response.choices[0])  # type: ignore  # Expected type: openai.types.chat.chat_completion.Choice
    reveal_type(response.usage)  # type: ignore  # Expected type: openai.types.completion_usage.CompletionUsage
    assert isinstance(response, ChatCompletion)
    assert isinstance(response.choices[0], Choice)
    assert isinstance(response.usage, CompletionUsage)
