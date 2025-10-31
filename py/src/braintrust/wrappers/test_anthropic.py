"""
Tests to ensure we reliably wrap the Anthropic API.
"""

import time

import anthropic
import pytest

from braintrust import logger
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.anthropic import wrap_anthropic

TEST_ORG_ID = "test-org-123"
PROJECT_NAME = "test-anthropic-app"
MODEL = "claude-3-haiku-20240307"  # use the cheapest model since answers dont matter


@pytest.fixture(scope="module")
def vcr_config():
    return {
        "filter_headers": [
            "authorization",
            "x-api-key",
        ]
    }


def _get_client():
    return anthropic.Anthropic()


def _get_async_client():
    return anthropic.AsyncAnthropic()


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


@pytest.mark.vcr
def test_anthropic_messages_create_stream_true(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_client())
    kws = {
        "model": MODEL,
        "max_tokens": 300,
        "messages": [{"role": "user", "content": "What is 3*4?"}],
        "stream": True,
    }

    start = time.time()
    with client.messages.create(**kws) as out:
        msgs = [m for m in out]
    end = time.time()

    assert msgs  # a very coarse grained check that this works

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert span["metadata"]["provider"] == "anthropic"
    assert span["metadata"]["max_tokens"] == 300
    assert span["metadata"]["stream"] == True
    metrics = span["metrics"]
    _assert_metrics_are_valid(metrics, start, end)
    assert span["input"] == kws["messages"]
    assert span["output"]
    assert span["output"]["role"] == "assistant"
    assert "12" in span["output"]["content"][0]["text"]


@pytest.mark.vcr
def test_anthropic_messages_model_params_inputs(memory_logger):
    assert not memory_logger.pop()
    client = wrap_anthropic(_get_client())

    kw = {
        "model": MODEL,
        "max_tokens": 300,
        "system": "just return the number",
        "messages": [{"role": "user", "content": "what is 1+1?"}],
        "temperature": 0.5,
        "top_p": 0.5,
    }

    def _with_messages_create():
        return client.messages.create(**kw)

    def _with_messages_stream():
        with client.messages.stream(**kw) as stream:
            for msg in stream:
                pass
        return stream.get_final_message()

    for f in [_with_messages_create, _with_messages_stream]:
        msg = f()
        assert msg.content[0].text == "2"

        logs = memory_logger.pop()
        assert len(logs) == 1
        log = logs[0]
        assert log["output"]["role"] == "assistant"
        assert "2" in log["output"]["content"][0]["text"]
        assert log["metadata"]["model"] == MODEL
        assert log["metadata"]["max_tokens"] == 300
        assert log["metadata"]["temperature"] == 0.5
        assert log["metadata"]["top_p"] == 0.5


@pytest.mark.vcr
def test_anthropic_messages_system_prompt_inputs(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_client())
    system = "Today's date is 2024-03-26. Only return the date"
    q = [{"role": "user", "content": "what is tomorrow's date? only return the date"}]

    args = {
        "messages": q,
        "temperature": 0,
        "max_tokens": 300,
        "system": system,
        "model": MODEL,
    }

    def _with_messages_create():
        return client.messages.create(**args)

    def _with_messages_stream():
        with client.messages.stream(**args) as stream:
            for msg in stream:
                pass
        return stream.get_final_message()

    for f in [_with_messages_create, _with_messages_stream]:
        msg = f()
        assert "2024-03-27" in msg.content[0].text

        logs = memory_logger.pop()
        assert len(logs) == 1
        log = logs[0]
        inputs = log["input"]
        assert len(inputs) == 2
        inputs_by_role = {m["role"]: m["content"] for m in inputs}
        assert inputs_by_role["system"] == system
        assert inputs_by_role["user"] == q[0]["content"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_anthropic_messages_create_async(memory_logger):
    assert not memory_logger.pop()

    params = {
        "model": MODEL,
        "max_tokens": 100,
        "messages": [{"role": "user", "content": "what is 6+1?, just return the number"}],
    }

    client = wrap_anthropic(anthropic.AsyncAnthropic())
    msg = await client.messages.create(**params)
    assert "7" in msg.content[0].text

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert span["metadata"]["max_tokens"] == 100
    assert span["input"] == params["messages"]
    assert span["output"]["role"] == "assistant"
    assert "7" in span["output"]["content"][0]["text"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_anthropic_messages_create_async_stream_true(memory_logger):
    assert not memory_logger.pop()

    params = {
        "model": MODEL,
        "max_tokens": 100,
        "messages": [{"role": "user", "content": "what is 6+1?, just return the number"}],
        "stream": True,
    }

    client = wrap_anthropic(anthropic.AsyncAnthropic())
    stream = await client.messages.create(**params)
    async for event in stream:
        pass

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert span["metadata"]["max_tokens"] == 100
    assert span["input"] == params["messages"]
    assert span["output"]["role"] == "assistant"
    assert "7" in span["output"]["content"][0]["text"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_anthropic_messages_streaming_async(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_async_client())
    msgs_in = [{"role": "user", "content": "what is 1+1?, just return the number"}]

    start = time.time()
    msg_out = None

    async with client.messages.stream(max_tokens=1024, messages=msgs_in, model=MODEL) as stream:
        async for event in stream:
            pass
        msg_out = await stream.get_final_message()
        assert msg_out.content[0].text == "2"
        usage = msg_out.usage
    end = time.time()

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert "user" in str(log["input"])
    assert "1+1" in str(log["input"])
    assert "2" in str(log["output"])
    assert log["project_id"] == PROJECT_NAME
    assert log["span_attributes"]["type"] == "llm"
    assert log["metadata"]["model"] == MODEL
    assert log["metadata"]["max_tokens"] == 1024
    _assert_metrics_are_valid(log["metrics"], start, end)
    metrics = log["metrics"]
    assert metrics["prompt_tokens"] == usage.input_tokens
    assert metrics["completion_tokens"] == usage.output_tokens
    assert metrics["tokens"] == usage.input_tokens + usage.output_tokens
    assert metrics["prompt_cached_tokens"] == usage.cache_read_input_tokens
    assert metrics["prompt_cache_creation_tokens"] == usage.cache_creation_input_tokens
    assert log["metadata"]["model"] == MODEL
    assert log["metadata"]["max_tokens"] == 1024


@pytest.mark.vcr
def test_anthropic_client_error(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_client())

    fake_model = "there-is-no-such-model"
    msg_in = {"role": "user", "content": "who are you?"}

    try:
        client.messages.create(model=fake_model, max_tokens=999, messages=[msg_in])
    except Exception:
        pass
    else:
        raise Exception("should have raised an exception")

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert log["project_id"] == PROJECT_NAME
    assert "404" in log["error"]


@pytest.mark.vcr
def test_anthropic_messages_stream_errors(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_client())
    msg_in = {"role": "user", "content": "what is 2+2? (just the number)"}

    try:
        with client.messages.stream(model=MODEL, max_tokens=300, messages=[msg_in]) as stream:
            raise Exception("fake-error")
    except Exception:
        pass
    else:
        raise Exception("should have raised an exception")

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert "Exception: fake-error" in span["error"]
    assert span["metrics"]["end"] > 0


@pytest.mark.vcr
def test_anthropic_messages_streaming_sync(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_client())
    msg_in = {"role": "user", "content": "what is 2+2? (just the number)"}

    start = time.time()
    with client.messages.stream(model=MODEL, max_tokens=300, messages=[msg_in]) as stream:
        msgs_out = [m for m in stream]
    end = time.time()
    msg_out = stream.get_final_message()
    usage = msg_out.usage
    # crudely check that the stream is valid
    assert len(msgs_out) > 3
    assert 1 <= len([m for m in msgs_out if m.type == "text"])
    assert msgs_out[0].type == "message_start"
    assert msgs_out[-1].type == "message_stop"

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert "user" in str(log["input"])
    assert "2+2" in str(log["input"])
    assert "4" in str(log["output"])
    assert log["project_id"] == PROJECT_NAME
    assert log["span_attributes"]["type"] == "llm"
    _assert_metrics_are_valid(log["metrics"], start, end)
    assert log["metrics"]["prompt_tokens"] == usage.input_tokens
    assert log["metrics"]["completion_tokens"] == usage.output_tokens
    assert log["metrics"]["tokens"] == usage.input_tokens + usage.output_tokens
    assert log["metrics"]["prompt_cached_tokens"] == usage.cache_read_input_tokens
    assert log["metrics"]["prompt_cache_creation_tokens"] == usage.cache_creation_input_tokens


@pytest.mark.vcr
def test_anthropic_messages_sync(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_client())

    msg_in = {"role": "user", "content": "what's 2+2?"}

    start = time.time()
    msg = client.messages.create(model=MODEL, max_tokens=300, messages=[msg_in])
    end = time.time()

    text = msg.content[0].text
    assert text

    # verify we generated the right spans.
    logs = memory_logger.pop()

    assert len(logs) == 1
    log = logs[0]
    assert "2+2" in str(log["input"])
    assert "4" in str(log["output"])
    assert log["project_id"] == PROJECT_NAME
    assert log["span_id"]
    assert log["root_span_id"]
    attrs = log["span_attributes"]
    assert attrs["type"] == "llm"
    assert "anthropic" in attrs["name"]
    metrics = log["metrics"]
    _assert_metrics_are_valid(metrics, start, end)
    assert log["metadata"]["model"] == MODEL


def _assert_metrics_are_valid(metrics, start, end):
    assert metrics["tokens"] > 0
    assert metrics["prompt_tokens"] > 0
    assert metrics["completion_tokens"] > 0
    if start and end:
        assert start <= metrics["start"] <= metrics["end"] <= end
    else:
        assert metrics["start"] <= metrics["end"]


@pytest.mark.vcr
def test_anthropic_beta_messages_sync(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_client())
    msg_in = {"role": "user", "content": "what's 3+3?"}

    start = time.time()
    msg = client.beta.messages.create(model=MODEL, max_tokens=300, messages=[msg_in])
    end = time.time()

    text = msg.content[0].text
    assert text
    assert "6" in text

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert "3+3" in str(log["input"])
    assert "6" in str(log["output"])
    assert log["project_id"] == PROJECT_NAME
    assert log["span_id"]
    assert log["root_span_id"]
    attrs = log["span_attributes"]
    assert attrs["type"] == "llm"
    assert "anthropic" in attrs["name"]
    metrics = log["metrics"]
    _assert_metrics_are_valid(metrics, start, end)
    assert log["metadata"]["model"] == MODEL


@pytest.mark.vcr
def test_anthropic_beta_messages_stream_sync(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_client())
    msg_in = {"role": "user", "content": "what is 5+5? (just the number)"}

    start = time.time()
    with client.beta.messages.stream(model=MODEL, max_tokens=300, messages=[msg_in]) as stream:
        msgs_out = [m for m in stream]
    end = time.time()
    msg_out = stream.get_final_message()
    usage = msg_out.usage

    assert len(msgs_out) > 3
    assert msgs_out[0].type == "message_start"
    assert msgs_out[-1].type == "message_stop"
    assert "10" in msg_out.content[0].text

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert "user" in str(log["input"])
    assert "5+5" in str(log["input"])
    assert "10" in str(log["output"])
    assert log["project_id"] == PROJECT_NAME
    assert log["span_attributes"]["type"] == "llm"
    _assert_metrics_are_valid(log["metrics"], start, end)
    assert log["metrics"]["prompt_tokens"] == usage.input_tokens
    assert log["metrics"]["completion_tokens"] == usage.output_tokens
    assert log["metrics"]["tokens"] == usage.input_tokens + usage.output_tokens


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_anthropic_beta_messages_create_async(memory_logger):
    assert not memory_logger.pop()

    params = {
        "model": MODEL,
        "max_tokens": 100,
        "messages": [{"role": "user", "content": "what is 8+2?, just return the number"}],
    }

    client = wrap_anthropic(anthropic.AsyncAnthropic())
    msg = await client.beta.messages.create(**params)
    assert "10" in msg.content[0].text

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span["metadata"]["model"] == MODEL
    assert span["metadata"]["max_tokens"] == 100
    assert span["input"] == params["messages"]
    assert span["output"]["role"] == "assistant"
    assert "10" in span["output"]["content"][0]["text"]


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_anthropic_beta_messages_streaming_async(memory_logger):
    assert not memory_logger.pop()

    client = wrap_anthropic(_get_async_client())
    msgs_in = [{"role": "user", "content": "what is 9+1?, just return the number"}]

    start = time.time()
    msg_out = None

    async with client.beta.messages.stream(max_tokens=1024, messages=msgs_in, model=MODEL) as stream:
        async for event in stream:
            pass
        msg_out = await stream.get_final_message()
        assert "10" in msg_out.content[0].text
        usage = msg_out.usage
    end = time.time()

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert "user" in str(log["input"])
    assert "9+1" in str(log["input"])
    assert "10" in str(log["output"])
    assert log["project_id"] == PROJECT_NAME
    assert log["span_attributes"]["type"] == "llm"
    assert log["metadata"]["model"] == MODEL
    assert log["metadata"]["max_tokens"] == 1024
    _assert_metrics_are_valid(log["metrics"], start, end)
    metrics = log["metrics"]
    assert metrics["prompt_tokens"] == usage.input_tokens
    assert metrics["completion_tokens"] == usage.output_tokens
    assert metrics["tokens"] == usage.input_tokens + usage.output_tokens
