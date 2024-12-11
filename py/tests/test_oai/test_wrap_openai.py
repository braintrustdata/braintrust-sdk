import json
import logging
from inspect import iscoroutinefunction

import openai
import pytest
import responses
from braintrust.oai import wrap_openai
from openai.types import CompletionUsage
from openai.types.chat import ChatCompletion
from openai.types.chat.chat_completion import ChatCompletionMessage, Choice
from responses import matchers
from responses.registries import OrderedRegistry

logging.basicConfig(level=logging.DEBUG)


@pytest.fixture
def openai_client():
    client = openai.OpenAI(api_key="sk-test")
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
    with responses.RequestsMock(registry=OrderedRegistry, assert_all_requests_are_fired=True) as rsps:
        yield rsps


def test_wrap_openai_sync_types(openai_client):
    wrapped = wrap_openai(openai_client)
    assert hasattr(wrapped.chat.completions, "create")
    assert not hasattr(wrapped.chat.completions, "acreate")


@pytest.mark.asyncio
async def test_wrap_openai_async_types():
    async_client = openai.AsyncOpenAI(api_key="sk-test")
    wrapped = wrap_openai(async_client)
    assert hasattr(wrapped.chat.completions, "create")
    assert iscoroutinefunction(wrapped.chat.completions.create)


@responses.activate
def test_wrap_openai_sync_response_types(openai_client, mock_completion, setup_responses):
    def request_callback(request):
        logging.debug(f"Request headers: {json.dumps(dict(request.headers), indent=2)}")
        logging.debug(f"Request URL: {request.url}")
        return (
            200,
            {
                "Content-Type": "application/json",
                "OpenAI-Organization": "test-org",
                "OpenAI-Processing-Ms": "100",
                "OpenAI-Version": "2020-10-01",
                "x-request-id": "test-request-id",
            },
            json.dumps(mock_completion),
        )

    setup_responses.add_callback(
        responses.POST,
        "https://api.openai.com/v1/chat/completions",
        callback=request_callback,
        content_type="application/json",
        match=[
            matchers.header_matcher(
                {
                    "Authorization": f"Bearer sk-test",
                    "Content-Type": "application/json",
                    "OpenAI-Version": "2020-10-01",
                    "User-Agent": matchers.ANY,
                }
            )
        ],
        match_querystring=False,
    )

    wrapped = wrap_openai(openai_client)
    response = wrapped.chat.completions.create(model="gpt-3.5-turbo", messages=[{"role": "user", "content": "Hello"}])
    assert isinstance(response, ChatCompletion)
    assert isinstance(response.choices[0], Choice)
    assert isinstance(response.choices[0].message, ChatCompletionMessage)
    assert isinstance(response.usage, CompletionUsage)
    assert isinstance(response.choices[0].message.content, str)
    assert isinstance(response.usage.total_tokens, int)


@responses.activate
@pytest.mark.asyncio
async def test_wrap_openai_async_response_types(mock_completion, setup_responses):
    def request_callback(request):
        logging.debug(f"Request headers: {json.dumps(dict(request.headers), indent=2)}")
        logging.debug(f"Request URL: {request.url}")
        return (
            200,
            {
                "Content-Type": "application/json",
                "OpenAI-Organization": "test-org",
                "OpenAI-Processing-Ms": "100",
                "OpenAI-Version": "2020-10-01",
                "x-request-id": "test-request-id",
            },
            json.dumps(mock_completion),
        )

    setup_responses.add_callback(
        responses.POST,
        "https://api.openai.com/v1/chat/completions",
        callback=request_callback,
        content_type="application/json",
        match=[
            matchers.header_matcher(
                {
                    "Authorization": f"Bearer sk-test",
                    "Content-Type": "application/json",
                    "OpenAI-Version": "2020-10-01",
                    "User-Agent": matchers.ANY,
                }
            )
        ],
        match_querystring=False,
    )

    async_client = openai.AsyncOpenAI(api_key="sk-test")
    wrapped = wrap_openai(async_client)
    response = await wrapped.chat.completions.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": "Hello"}]
    )
    assert isinstance(response, ChatCompletion)
    assert isinstance(response.choices[0], Choice)
    assert isinstance(response.choices[0].message, ChatCompletionMessage)
    assert isinstance(response.usage, CompletionUsage)
    assert isinstance(response.choices[0].message.content, str)
    assert isinstance(response.usage.total_tokens, int)
