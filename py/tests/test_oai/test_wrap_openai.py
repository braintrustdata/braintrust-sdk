from inspect import iscoroutinefunction

import openai
import pytest
import responses
from braintrust import wrap_openai
from openai.types import CompletionUsage
from openai.types.chat import ChatCompletion
from openai.types.chat.chat_completion import ChatCompletionMessage, Choice


@pytest.fixture
def openai_client():
    client = openai.OpenAI(api_key="test-key", base_url="https://api.openai.com/v1")
    return client


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


@pytest.fixture(autouse=True)
def setup_responses():
    with responses.RequestsMock() as rsps:
        yield rsps


def test_wrap_openai_sync_types(openai_client):
    wrapped = wrap_openai(openai_client)
    assert hasattr(wrapped.chat.completions, "create")
    assert not hasattr(wrapped.chat.completions, "acreate")


@pytest.mark.asyncio
async def test_wrap_openai_async_types():
    async_client = openai.AsyncOpenAI(api_key="test-key", base_url="https://api.openai.com/v1")
    wrapped = wrap_openai(async_client)
    assert hasattr(wrapped.chat.completions, "create")
    assert iscoroutinefunction(wrapped.chat.completions.create)


@responses.activate
def test_wrap_openai_sync_response_types(openai_client, mock_completion):
    responses.add(
        responses.POST,
        "https://api.openai.com/v1/chat/completions",
        json=mock_completion,
        status=200,
    )

    wrapped = wrap_openai(openai_client)
    response = wrapped.chat.completions.create(model="gpt-3.5-turbo", messages=[{"role": "user", "content": "Hello"}])
    assert isinstance(response, ChatCompletion)
    assert isinstance(response.choices[0], Choice)
    assert isinstance(response.choices[0].message, ChatCompletionMessage)
    assert isinstance(response.usage, CompletionUsage)
    assert isinstance(response.id, str)
    assert isinstance(response.choices[0].message.content, str)
    assert isinstance(response.usage.total_tokens, int)


@responses.activate
@pytest.mark.asyncio
async def test_wrap_openai_async_response_types(mock_completion):
    async_client = openai.AsyncOpenAI(api_key="test-key", base_url="https://api.openai.com/v1")
    responses.add(
        responses.POST,
        "https://api.openai.com/v1/chat/completions",
        json=mock_completion,
        status=200,
    )

    wrapped = wrap_openai(async_client)
    response = await wrapped.chat.completions.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": "Hello"}]
    )
    assert isinstance(response, ChatCompletion)
    assert isinstance(response.choices[0], Choice)
    assert isinstance(response.choices[0].message, ChatCompletionMessage)
    assert isinstance(response.usage, CompletionUsage)
    assert isinstance(response.id, str)
    assert isinstance(response.choices[0].message.content, str)
    assert isinstance(response.usage.total_tokens, int)
