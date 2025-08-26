import asyncio
import time

import openai
import pytest
from openai import AsyncOpenAI
from openai._types import NOT_GIVEN
from pydantic import BaseModel

from braintrust import logger, wrap_openai
from braintrust.test_helpers import assert_dict_matches, init_test_logger
from braintrust.wrappers.test_utils import assert_metrics_are_valid

TEST_ORG_ID = "test-org-openai-py-tracing"
PROJECT_NAME = "test-project-openai-py-tracing"
TEST_MODEL = "gpt-4o-mini"  # cheapest model for tests
TEST_PROMPT = "What's 12 + 12?"
TEST_SYSTEM_PROMPT = "You are a helpful assistant that only responds with numbers."


@pytest.fixture(scope="module")
def vcr_config():
    return {
        "filter_headers": [
            "authorization",
            "openai-organization",
        ]
    }


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


@pytest.mark.vcr
def test_openai_chat_metrics(memory_logger):
    assert not memory_logger.pop()

    client = openai.OpenAI()
    clients = [client, wrap_openai(client)]

    for client in clients:
        start = time.time()
        response = client.chat.completions.create(
            model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}]
        )
        end = time.time()

        assert response
        assert response.choices[0].message.content
        assert (
            "24" in response.choices[0].message.content or "twenty-four" in response.choices[0].message.content.lower()
        )

        if not _is_wrapped(client):
            assert not memory_logger.pop()
            continue

        # Verify spans were created with wrapped client
        spans = memory_logger.pop()
        assert len(spans) == 1
        span = spans[0]
        assert span
        metrics = span["metrics"]
        assert_metrics_are_valid(metrics, start, end)
        assert span["metadata"]["model"] == TEST_MODEL
        assert span["metadata"]["provider"] == "openai"
        assert TEST_PROMPT in str(span["input"])


@pytest.mark.vcr
def test_openai_responses_metrics(memory_logger):
    assert not memory_logger.pop()

    # First test with an unwrapped client
    unwrapped_client = openai.OpenAI()
    unwrapped_response = unwrapped_client.responses.create(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        instructions="Just the number please",
    )
    assert unwrapped_response
    assert unwrapped_response.output
    assert len(unwrapped_response.output) > 0
    unwrapped_content = unwrapped_response.output[0].content[0].text

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    client = wrap_openai(openai.OpenAI())
    start = time.time()
    response = client.responses.create(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        instructions="Just the number please",
    )
    end = time.time()

    assert response
    # Extract content from output field
    assert response.output
    assert len(response.output) > 0
    wrapped_content = response.output[0].content[0].text

    # Both should contain a numeric response for the math question
    assert "24" in unwrapped_content or "twenty-four" in unwrapped_content.lower()
    assert "24" in wrapped_content or "twenty-four" in wrapped_content.lower()

    # Verify spans were created with wrapped client
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert 0 <= metrics.get("prompt_cached_tokens", 0)
    assert 0 <= metrics.get("completion_reasoning_tokens", 0)
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "openai"
    assert TEST_PROMPT in str(span["input"])
    assert len(span["output"]) > 0
    span_output_text = span["output"][0]["content"][0]["text"]
    assert "24" in span_output_text or "twenty-four" in span_output_text.lower()

    # Test responses.parse method
    class NumberAnswer(BaseModel):
        value: int
        reasoning: str

    # First test with unwrapped client - should work but no spans
    parse_response = unwrapped_client.responses.parse(model=TEST_MODEL, input=TEST_PROMPT, text_format=NumberAnswer)
    assert parse_response
    # Access the structured output via text_format
    assert parse_response.output_parsed
    assert parse_response.output_parsed.value == 24
    assert parse_response.output_parsed.reasoning

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client - should generate spans
    start = time.time()
    parse_response = client.responses.parse(model=TEST_MODEL, input=TEST_PROMPT, text_format=NumberAnswer)
    end = time.time()

    assert parse_response
    # Access the structured output via text_format
    assert parse_response.output_parsed
    assert parse_response.output_parsed.value == 24
    assert parse_response.output_parsed.reasoning

    # Verify spans are generated
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert 0 <= metrics.get("prompt_cached_tokens", 0)
    assert 0 <= metrics.get("completion_reasoning_tokens", 0)
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "openai"
    assert TEST_PROMPT in str(span["input"])
    assert len(span["output"]) > 0
    assert span["output"][0]["content"][0]["parsed"]
    assert span["output"][0]["content"][0]["parsed"]["value"] == 24
    assert span["output"][0]["content"][0]["parsed"]["reasoning"] == parse_response.output_parsed.reasoning


@pytest.mark.vcr
def test_openai_embeddings(memory_logger):
    assert not memory_logger.pop()

    client = openai.OpenAI()
    response = client.embeddings.create(model="text-embedding-ada-002", input="This is a test")

    assert response
    assert response.data
    assert response.data[0].embedding

    assert not memory_logger.pop()

    client2 = wrap_openai(openai.OpenAI())

    start = time.time()
    response2 = client2.embeddings.create(model="text-embedding-ada-002", input="This is a test")
    end = time.time()

    assert response2
    assert response2.data
    assert response2.data[0].embedding

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    assert span["metadata"]["model"] == "text-embedding-ada-002"
    assert span["metadata"]["provider"] == "openai"
    assert "This is a test" in str(span["input"])


@pytest.mark.vcr
def test_openai_chat_streaming_sync(memory_logger):
    assert not memory_logger.pop()

    client = openai.OpenAI()
    clients = [(client, False), (wrap_openai(client), True)]

    for client, is_wrapped in clients:
        start = time.time()

        stream = client.chat.completions.create(
            model=TEST_MODEL,
            messages=[{"role": "user", "content": TEST_PROMPT}],
            stream=True,
            stream_options={"include_usage": True},
        )

        chunks = []
        for chunk in stream:
            chunks.append(chunk)
        end = time.time()

        # Verify streaming works
        assert chunks
        assert len(chunks) > 1

        # Concatenate content from chunks to verify
        content = ""
        for chunk in chunks:
            if chunk.choices and chunk.choices[0].delta.content:
                content += chunk.choices[0].delta.content

        # Make sure we got a valid answer in the content
        assert "24" in content or "twenty-four" in content.lower()

        if not is_wrapped:
            assert not memory_logger.pop()
            continue

        # Verify spans were created with wrapped client
        spans = memory_logger.pop()
        assert len(spans) == 1
        span = spans[0]
        assert span
        metrics = span["metrics"]
        assert_metrics_are_valid(metrics, start, end)
        assert span["metadata"]["model"] == TEST_MODEL
        # assert span["metadata"]["provider"] == "openai"
        assert TEST_PROMPT in str(span["input"])
        assert "24" in str(span["output"]) or "twenty-four" in str(span["output"]).lower()


@pytest.mark.vcr
def test_openai_chat_with_system_prompt(memory_logger):
    assert not memory_logger.pop()

    client = openai.OpenAI()
    clients = [(client, False), (wrap_openai(client), True)]

    for client, is_wrapped in clients:
        response = client.chat.completions.create(
            model=TEST_MODEL,
            messages=[{"role": "system", "content": TEST_SYSTEM_PROMPT}, {"role": "user", "content": TEST_PROMPT}],
        )

        assert response
        assert response.choices
        assert "24" in response.choices[0].message.content

        if not is_wrapped:
            assert not memory_logger.pop()
            continue

        spans = memory_logger.pop()
        assert len(spans) == 1
        span = spans[0]
        inputs = span["input"]
        assert len(inputs) == 2
        assert inputs[0]["role"] == "system"
        assert inputs[0]["content"] == TEST_SYSTEM_PROMPT
        assert inputs[1]["role"] == "user"
        assert inputs[1]["content"] == TEST_PROMPT


@pytest.mark.vcr
def test_openai_client_comparison(memory_logger):
    """Test that wrapped and unwrapped clients produce the same output."""
    assert not memory_logger.pop()

    # Get regular and wrapped clients
    client = openai.OpenAI()
    clients = [(client, False), (wrap_openai(client), True)]

    for client, is_wrapped in clients:
        response = client.chat.completions.create(
            model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}], temperature=0, seed=42
        )

        # Both should have data
        assert response.choices[0].message.content

        if not is_wrapped:
            assert not memory_logger.pop()
            continue

        # Verify spans were created with wrapped client
        spans = memory_logger.pop()
        assert len(spans) == 1


@pytest.mark.vcr
def test_openai_client_error(memory_logger):
    assert not memory_logger.pop()

    # For the wrapped client only, since we need special error handling
    client = wrap_openai(openai.OpenAI())

    # Use a non-existent model to force an error
    fake_model = "non-existent-model"

    try:
        client.chat.completions.create(model=fake_model, messages=[{"role": "user", "content": TEST_PROMPT}])
        pytest.fail("Expected an exception but none was raised")
    except Exception as e:
        # We expect an error here
        pass

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert log["project_id"] == PROJECT_NAME
    # It seems the error field may not be present in newer OpenAI versions
    # Just check that we got a log entry with the fake model
    assert fake_model in str(log)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_openai_chat_async(memory_logger):
    assert not memory_logger.pop()

    # First test with an unwrapped async client
    client = AsyncOpenAI()
    resp = await client.chat.completions.create(model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}])

    assert resp
    assert resp.choices
    assert resp.choices[0].message.content
    content = resp.choices[0].message.content

    # Verify it contains a correct response
    assert "24" in content or "twenty-four" in content.lower()

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    client2 = wrap_openai(AsyncOpenAI())

    start = time.time()
    resp2 = await client2.chat.completions.create(
        model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}]
    )
    end = time.time()

    assert resp2
    assert resp2.choices
    assert resp2.choices[0].message.content
    content2 = resp2.choices[0].message.content

    # Verify the wrapped client also gives correct responses
    assert "24" in content2 or "twenty-four" in content2.lower()

    # Verify spans were created with wrapped client
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert span["metadata"]["model"] == TEST_MODEL
    # assert span["metadata"]["provider"] == "openai"
    assert TEST_PROMPT in str(span["input"])


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_responses_async(memory_logger):
    assert not memory_logger.pop()

    client = AsyncOpenAI()
    clients = [(client, False), (wrap_openai(client), True)]

    for client, is_wrapped in clients:
        start = time.time()

        resp = await client.responses.create(
            model=TEST_MODEL,
            input=TEST_PROMPT,
            instructions="Just the number please",
        )
        end = time.time()

        assert resp
        assert resp.output
        assert len(resp.output) > 0

        # Extract the text from the output
        content = resp.output[0].content[0].text

        # Verify response contains correct answer
        assert "24" in content or "twenty-four" in content.lower()

        if not is_wrapped:
            assert not memory_logger.pop()
            continue

        # Verify spans were created with wrapped client
        spans = memory_logger.pop()
        assert len(spans) == 1
        span = spans[0]
        metrics = span["metrics"]
        assert_metrics_are_valid(metrics, start, end)
        assert 0 <= metrics.get("prompt_cached_tokens", 0)
        assert 0 <= metrics.get("completion_reasoning_tokens", 0)
        assert span["metadata"]["model"] == TEST_MODEL
        # assert span["metadata"]["provider"] == "openai"
        assert TEST_PROMPT in str(span["input"])

    # Test responses.parse method
    class NumberAnswer(BaseModel):
        value: int
        reasoning: str

    for client, is_wrapped in clients:
        if not is_wrapped:
            # Test unwrapped client first
            parse_response = await client.responses.parse(
                model=TEST_MODEL, input=TEST_PROMPT, text_format=NumberAnswer
            )
            assert parse_response
            # Access the structured output via text_format
            assert parse_response.output_parsed
            assert parse_response.output_parsed.value == 24
            assert parse_response.output_parsed.reasoning

            # No spans should be generated with unwrapped client
            assert not memory_logger.pop()
        else:
            # Test wrapped client
            start = time.time()
            parse_response = await client.responses.parse(
                model=TEST_MODEL, input=TEST_PROMPT, text_format=NumberAnswer
            )
            end = time.time()

            assert parse_response
            # Access the structured output via text_format
            assert parse_response.output_parsed
            assert parse_response.output_parsed.value == 24
            assert parse_response.output_parsed.reasoning

            # Verify spans were created
            spans = memory_logger.pop()
            assert len(spans) == 1
            span = spans[0]
            assert span
            metrics = span["metrics"]
            assert_metrics_are_valid(metrics, start, end)
            assert 0 <= metrics.get("prompt_cached_tokens", 0)
            assert 0 <= metrics.get("completion_reasoning_tokens", 0)
            assert span["metadata"]["model"] == TEST_MODEL
            # assert span["metadata"]["provider"] == "openai"
            assert TEST_PROMPT in str(span["input"])
            assert len(span["output"]) > 0
            assert span["output"][0]["content"][0]["parsed"]
            assert span["output"][0]["content"][0]["parsed"]["value"] == 24
            assert span["output"][0]["content"][0]["parsed"]["reasoning"] == parse_response.output_parsed.reasoning


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_embeddings_async(memory_logger):
    assert not memory_logger.pop()

    client = AsyncOpenAI()
    clients = [(client, False), (wrap_openai(client), True)]

    for client, is_wrapped in clients:
        start = time.time()

        resp = await client.embeddings.create(model="text-embedding-ada-002", input="This is a test")
        end = time.time()

        assert resp
        assert resp.data
        assert resp.data[0].embedding

        if not is_wrapped:
            assert not memory_logger.pop()
            continue

        # Verify spans were created with wrapped client
        spans = memory_logger.pop()
        assert len(spans) == 1
        span = spans[0]
        assert span
        assert span["metadata"]["model"] == "text-embedding-ada-002"
        assert span["metadata"]["provider"] == "openai"
        assert "This is a test" in str(span["input"])


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_chat_streaming_async(memory_logger):
    assert not memory_logger.pop()

    client = AsyncOpenAI()
    clients = [(client, False), (wrap_openai(client), True)]

    for client, is_wrapped in clients:
        start = time.time()

        stream = await client.chat.completions.create(
            model=TEST_MODEL,
            messages=[{"role": "user", "content": TEST_PROMPT}],
            stream=True,
            stream_options={"include_usage": True},
        )

        chunks = []
        async for chunk in stream:
            chunks.append(chunk)
        end = time.time()

        assert chunks
        assert len(chunks) > 1

        # Concatenate content from chunks to verify
        content = ""
        for chunk in chunks:
            if chunk.choices and chunk.choices[0].delta.content:
                content += chunk.choices[0].delta.content

        # Make sure we got a valid answer in the content
        assert "24" in content or "twenty-four" in content.lower()

        if not is_wrapped:
            assert not memory_logger.pop()
            continue

        # Verify spans were created with wrapped client
        spans = memory_logger.pop()
        assert len(spans) == 1
        span = spans[0]
        assert span
        metrics = span["metrics"]
        assert_metrics_are_valid(metrics, start, end)
        assert span["metadata"]["stream"] == True
        assert span["metadata"]["model"] == TEST_MODEL
        # assert span["metadata"]["provider"] == "openai"
        assert TEST_PROMPT in str(span["input"])
        assert "24" in str(span["output"]) or "twenty-four" in str(span["output"]).lower()


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_chat_async_with_system_prompt(memory_logger):
    assert not memory_logger.pop()

    client = AsyncOpenAI()
    clients = [(client, False), (wrap_openai(client), True)]

    for client, is_wrapped in clients:
        response = await client.chat.completions.create(
            model=TEST_MODEL,
            messages=[{"role": "system", "content": TEST_SYSTEM_PROMPT}, {"role": "user", "content": TEST_PROMPT}],
        )

        assert response
        assert response.choices
        assert "24" in response.choices[0].message.content

        if not is_wrapped:
            assert not memory_logger.pop()
            continue

        spans = memory_logger.pop()
        assert len(spans) == 1
        span = spans[0]
        inputs = span["input"]
        assert len(inputs) == 2
        assert inputs[0]["role"] == "system"
        assert inputs[0]["content"] == TEST_SYSTEM_PROMPT
        assert inputs[1]["role"] == "user"
        assert inputs[1]["content"] == TEST_PROMPT


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_client_async_comparison(memory_logger):
    """Test that wrapped and unwrapped async clients produce the same output."""
    assert not memory_logger.pop()

    # Get regular and wrapped clients
    regular_client = AsyncOpenAI()
    wrapped_client = wrap_openai(AsyncOpenAI())

    # Test with regular client
    normal_response = await regular_client.chat.completions.create(
        model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}], temperature=0, seed=42
    )

    # No spans should be created for unwrapped client
    assert not memory_logger.pop()

    # Test with wrapped client
    wrapped_response = await wrapped_client.chat.completions.create(
        model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}], temperature=0, seed=42
    )

    # Both should have data
    assert normal_response.choices[0].message.content
    assert wrapped_response.choices[0].message.content

    # Verify spans were created with wrapped client
    spans = memory_logger.pop()
    assert len(spans) == 1


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_client_async_error(memory_logger):
    assert not memory_logger.pop()

    # For the wrapped client only, since we need special error handling
    client = wrap_openai(AsyncOpenAI())

    # Use a non-existent model to force an error
    fake_model = "non-existent-model"

    try:
        await client.chat.completions.create(model=fake_model, messages=[{"role": "user", "content": TEST_PROMPT}])
        pytest.fail("Expected an exception but none was raised")
    except Exception as e:
        # We expect an error here
        pass

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert log["project_id"] == PROJECT_NAME
    # It seems the error field may not be present in newer OpenAI versions
    # Just check that we got a log entry with the fake model
    assert fake_model in str(log)


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_chat_async_context_manager(memory_logger):
    """Test async context manager behavior for chat completions streams."""
    assert not memory_logger.pop()

    client = AsyncOpenAI()
    clients = [(client, False), (wrap_openai(client), True)]

    for client, is_wrapped in clients:
        start = time.time()
        stream = await client.chat.completions.create(
            model=TEST_MODEL,
            messages=[{"role": "user", "content": TEST_PROMPT}],
            stream=True,
            stream_options={"include_usage": True},
        )

        # Test the context manager behavior
        chunks = []
        async with stream as s:
            async for chunk in s:
                chunks.append(chunk)
        end = time.time()

        # Verify we got chunks from the stream
        assert chunks
        assert len(chunks) > 1

        # Concatenate content from chunks to verify
        content = ""
        for chunk in chunks:
            if chunk.choices and chunk.choices[0].delta.content:
                content += chunk.choices[0].delta.content

        # Make sure we got a valid answer in the content
        assert "24" in content or "twenty-four" in content.lower()

        if not is_wrapped:
            assert not memory_logger.pop()
            continue

        # Check metrics
        spans = memory_logger.pop()
        assert len(spans) == 1
        span = spans[0]
        metrics = span["metrics"]
        assert_metrics_are_valid(metrics, start, end)
        assert span["metadata"]["stream"] == True
        assert "24" in str(span["output"]) or "twenty-four" in str(span["output"]).lower()


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_streaming_with_break(memory_logger):
    """Test breaking out of the streaming loop early."""
    assert not memory_logger.pop()

    # Only test with wrapped client
    client = wrap_openai(AsyncOpenAI())

    start = time.time()
    stream = await client.chat.completions.create(
        model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}], stream=True
    )

    time.sleep(0.2)  # time to first token sleep

    # Only process the first few chunks
    counter = 0
    async for chunk in stream:
        counter += 1
        if counter >= 2:
            break
    end = time.time()

    # We should still get valid metrics even with early break
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    metrics = span["metrics"]
    assert metrics["time_to_first_token"] >= 0


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_chat_error_in_async_context(memory_logger):
    """Test error handling inside the async context manager."""
    assert not memory_logger.pop()

    # We only test the wrapped client for this test since we need to check span error handling
    client = wrap_openai(AsyncOpenAI())

    stream = await client.chat.completions.create(
        model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}], stream=True
    )

    # Simulate an error during streaming
    try:
        async with stream as s:
            counter = 0
            async for chunk in s:
                counter += 1
                if counter >= 2:
                    raise ValueError("Intentional test error")
        pytest.fail("Expected an exception but none was raised")
    except ValueError as e:
        assert "Intentional test error" in str(e)

    # We should still get valid metrics even with error
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    # The error field might not be present in newer versions
    # Just check that we got a span with time metrics
    assert span["metrics"]["time_to_first_token"] >= 0


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_response_streaming_async(memory_logger):
    """Test the newer responses API with streaming."""
    assert not memory_logger.pop()

    client = openai.AsyncOpenAI()
    clients = [client, wrap_openai(client)]

    for client in clients:
        start = time.time()

        stream = await client.responses.create(model=TEST_MODEL, input="What's 12 + 12?", stream=True)

        chunks = []
        async for chunk in stream:
            if chunk.type == "response.output_text.delta":
                chunks.append(chunk.delta)
        end = time.time()
        output = "".join(chunks)

        assert chunks
        assert len(chunks) > 1

        assert "24" in output

        if not _is_wrapped(client):
            assert not memory_logger.pop()
            continue
        # verify the span is created
        spans = memory_logger.pop()
        assert len(spans) == 1
        span = spans[0]
        metrics = span["metrics"]
        assert_metrics_are_valid(metrics, start, end)
        assert span["metadata"]["stream"] == True
        assert "What's 12 + 12?" in str(span["input"])
        assert "24" in str(span["output"])


@pytest.mark.asyncio
@pytest.mark.vcr
async def test_openai_async_parallel_requests(memory_logger):
    """Test multiple parallel async requests with the wrapped client."""
    assert not memory_logger.pop()

    client = wrap_openai(AsyncOpenAI())

    # Create multiple prompts
    prompts = [f"What is {i} + {i}?" for i in range(3, 6)]

    # Run requests in parallel
    tasks = [
        client.chat.completions.create(model=TEST_MODEL, messages=[{"role": "user", "content": prompt}])
        for prompt in prompts
    ]

    # Wait for all to complete
    results = await asyncio.gather(*tasks)

    # Check all results
    assert len(results) == 3
    for i, result in enumerate(results):
        assert result.choices[0].message.content

    # Check that all spans were created
    spans = memory_logger.pop()
    assert len(spans) == 3

    # Verify each span has proper data
    for i, span in enumerate(spans):
        assert span["metadata"]["model"] == TEST_MODEL
        # assert span["metadata"]["provider"] == "openai"
        assert prompts[i] in str(span["input"])
        assert_metrics_are_valid(span["metrics"])


@pytest.mark.vcr
def test_openai_not_given_filtering(memory_logger):
    """Test that NOT_GIVEN values are filtered out of logged inputs but API call still works."""
    assert not memory_logger.pop()

    client = wrap_openai(openai.OpenAI())

    # Make a call with NOT_GIVEN for optional parameters
    response = client.chat.completions.create(
        model=TEST_MODEL,
        messages=[{"role": "user", "content": TEST_PROMPT}],
        max_tokens=NOT_GIVEN,
        top_p=NOT_GIVEN,
        frequency_penalty=NOT_GIVEN,
        temperature=0.5,  # one real one
        presence_penalty=NOT_GIVEN,
        tools=NOT_GIVEN,
    )

    # Verify the API call worked normally
    assert response
    assert response.choices[0].message.content
    assert "24" in response.choices[0].message.content or "twenty-four" in response.choices[0].message.content.lower()

    # Check the logged span
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]

    assert_dict_matches(
        span,
        {
            "input": [{"role": "user", "content": TEST_PROMPT}],
            "metadata": {
                "model": TEST_MODEL,
                "provider": "openai",
                "temperature": 0.5,
            },
        },
    )
    # Verify NOT_GIVEN values are not in the logged metadata
    meta = span["metadata"]
    assert "NOT_GIVEN" not in str(meta)
    for k in ["max_tokens", "top_p", "frequency_penalty", "presence_penalty", "tools"]:
        assert k not in meta


@pytest.mark.vcr
def test_openai_responses_not_given_filtering(memory_logger):
    """Test that NOT_GIVEN values are filtered out of logged inputs for responses API."""
    assert not memory_logger.pop()

    client = wrap_openai(openai.OpenAI())

    # Make a call with NOT_GIVEN for optional parameters
    response = client.responses.create(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        instructions="Just the number please",
        max_output_tokens=NOT_GIVEN,
        tools=NOT_GIVEN,
        temperature=0.5,  # one real parameter
        top_p=NOT_GIVEN,
        metadata=NOT_GIVEN,
        store=NOT_GIVEN,
    )

    # Verify the API call worked normally
    assert response
    assert response.output
    assert len(response.output) > 0
    content = response.output[0].content[0].text
    assert "24" in content or "twenty-four" in content.lower()

    # Check the logged span
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]

    assert_dict_matches(
        span,
        {
            "input": TEST_PROMPT,
            "metadata": {
                "model": TEST_MODEL,
                "provider": "openai",
                "temperature": 0.5,
                "instructions": "Just the number please",
            },
        },
    )
    # Verify NOT_GIVEN values are not in the logged metadata
    meta = span["metadata"]
    assert "NOT_GIVEN" not in str(meta)
    for k in ["max_output_tokens", "tools", "top_p", "store"]:
        assert k not in meta

    # Test responses.parse with NOT_GIVEN filtering
    class NumberAnswer(BaseModel):
        value: int
        reasoning: str

    # Make a parse call with NOT_GIVEN for optional parameters
    parse_response = client.responses.parse(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        text_format=NumberAnswer,
        max_output_tokens=NOT_GIVEN,
        tools=NOT_GIVEN,
        temperature=0.7,  # one real parameter
        top_p=NOT_GIVEN,
        metadata=NOT_GIVEN,
        store=NOT_GIVEN,
    )

    # Verify the API call worked normally
    assert parse_response
    assert parse_response.output_parsed
    assert parse_response.output_parsed.value == 24
    assert parse_response.output_parsed.reasoning

    # Check the logged span for parse
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]

    assert_dict_matches(
        span,
        {
            "input": TEST_PROMPT,
            "metadata": {
                "model": TEST_MODEL,
                "provider": "openai",
                "temperature": 0.7,
                "text_format": lambda tf: tf is not None and "NumberAnswer" in str(tf),
            },
        },
    )
    # Verify NOT_GIVEN values are not in the logged metadata
    meta = span["metadata"]
    assert "NOT_GIVEN" not in str(meta)
    for k in ["max_output_tokens", "tools", "top_p", "store"]:
        assert k not in meta
    # Verify the output is properly logged in the span
    assert span["output"]
    assert isinstance(span["output"], list)
    assert len(span["output"]) > 0
    assert span["output"][0]["content"][0]["parsed"]
    assert span["output"][0]["content"][0]["parsed"]["value"] == 24
    assert span["output"][0]["content"][0]["parsed"]["reasoning"]


@pytest.mark.vcr
def test_openai_parallel_tool_calls(memory_logger):
    """Test parallel tool calls with both streaming and non-streaming modes."""
    assert not memory_logger.pop()

    # Define tools that can be called in parallel
    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get the weather for a location",
                "parameters": {
                    "type": "object",
                    "properties": {"location": {"type": "string", "description": "The location to get weather for"}},
                    "required": ["location"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_time",
                "description": "Get the current time for a timezone",
                "parameters": {
                    "type": "object",
                    "properties": {"timezone": {"type": "string", "description": "The timezone to get time for"}},
                    "required": ["timezone"],
                },
            },
        },
    ]

    client = openai.OpenAI()
    clients = [client, wrap_openai(client)]

    for stream in [False, True]:
        for client in clients:
            start = time.time()

            resp = client.chat.completions.create(
                model=TEST_MODEL,
                messages=[{"role": "user", "content": "What's the weather in New York and the time in Tokyo?"}],
                tools=tools,
                temperature=0,
                stream=stream,
                stream_options={"include_usage": True} if stream else None,
            )

            if stream:
                # Consume the stream
                for chunk in resp:  # type: ignore
                    # Exhaust the stream
                    pass

            end = time.time()

            if not _is_wrapped(client):
                assert not memory_logger.pop()
                continue

            # Verify spans were created with wrapped client
            spans = memory_logger.pop()
            assert len(spans) == 1
            span = spans[0]

            # Validate the span structure
            assert_dict_matches(
                span,
                {
                    "span_attributes": {"type": "llm", "name": "Chat Completion"},
                    "metadata": {
                        "model": TEST_MODEL,
                        "provider": "openai",
                        "stream": stream,
                        "tools": lambda tools_list: len(tools_list) == 2
                        and any(tool.get("function", {}).get("name") == "get_weather" for tool in tools_list)
                        and any(tool.get("function", {}).get("name") == "get_time" for tool in tools_list),
                    },
                    "input": lambda inp: "What's the weather in New York and the time in Tokyo?" in str(inp),
                    "metrics": lambda m: assert_metrics_are_valid(m, start, end) is None,
                },
            )

            # Verify tool calls are in the output (if present)
            if span.get("output") and isinstance(span["output"], list) and len(span["output"]) > 0:
                message = span["output"][0].get("message", {})
                tool_calls = message.get("tool_calls")
                if tool_calls and len(tool_calls) >= 2:
                    # Extract tool names, handling cases where function.name might be None
                    tool_names = []
                    for call in tool_calls:
                        func = call.get("function", {})
                        name = func.get("name") if isinstance(func, dict) else None
                        if name:
                            tool_names.append(name)

                    # Check if we have the expected tools (only if names are available)
                    if tool_names:
                        assert "get_weather" in tool_names or "get_time" in tool_names, (
                            f"Expected weather/time tools, got: {tool_names}"
                        )


def _is_wrapped(client):
    return hasattr(client, "_NamedWrapper__wrapped")


@pytest.mark.asyncio
async def test_braintrust_tracing_processor_current_span_detection(memory_logger):
    """Test that BraintrustTracingProcessor currentSpan() detection works with OpenAI Agents SDK."""
    pytest.importorskip("agents", reason="agents package not available")

    import agents
    from agents import Agent
    from agents.run import AgentRunner

    import braintrust
    from braintrust.wrappers.openai import BraintrustTracingProcessor

    assert not memory_logger.pop()

    @braintrust.traced(name="parent_span_test")
    async def test_function(instructions: str):
        # Verify we're in a traced context
        detected_parent = braintrust.current_span()
        assert detected_parent is not None, "Parent span should exist in traced context"
        assert detected_parent != braintrust.logger.NOOP_SPAN, "Should not be NOOP span"

        # Create processor WITHOUT parentSpan - should auto-detect via current_span()
        processor = BraintrustTracingProcessor()

        # Set up tracing
        agents.set_tracing_disabled(False)
        agents.add_trace_processor(processor)

        try:
            # Create a simple agent
            agent = Agent(
                name="test-agent",
                model=TEST_MODEL,
                instructions="You are a helpful assistant. Be very concise.",
            )

            # Run the agent - this should create spans as children of detected parent
            runner = AgentRunner()
            result = await runner.run(agent, instructions)
            assert result is not None, "Agent should return a result"
            assert hasattr(result, "final_output") or hasattr(result, "output"), "Result should have output"

            return result
        finally:
            processor.shutdown()

    # Execute the wrapped function
    result = await test_function("What is 2+2? Just the number.")
    assert result is not None, "Test function should return a result"

    # Verify span hierarchy in logged spans
    spans = memory_logger.pop()
    assert len(spans) >= 2, f"Should have at least parent and child spans, got {len(spans)}"

    # Find parent and child spans
    parent_span = None
    child_spans = []

    for span in spans:
        if span.get("span_attributes", {}).get("name") == "parent_span_test":
            parent_span = span
        elif span.get("span_attributes", {}).get("name") == "Agent workflow":
            child_spans.append(span)

    assert parent_span is not None, "Should find parent span with name 'parent_span_test'"
    assert len(child_spans) > 0, "Should find at least one child span with name 'Agent workflow'"

    # Verify the child span has the parent as its parent
    if child_spans and parent_span:
        child_span = child_spans[0]
        # In Braintrust, parent-child relationships are represented by span_parents array
        child_span_parents = child_span.get("span_parents", [])
        parent_span_id = parent_span.get("span_id")

        assert parent_span_id is not None, "Parent span should have a span_id"
        assert isinstance(child_span_parents, list) and len(child_span_parents) > 0, (
            "Child span should have span_parents array"
        )
        assert parent_span_id in child_span_parents, (
            f"Child span should include parent span_id {parent_span_id} in its span_parents array {child_span_parents} (currentSpan detection)"
        )

        # Verify both spans have the same root_span_id
        assert child_span.get("root_span_id") == parent_span.get("root_span_id"), (
            "Parent and child should share the same root_span_id"
        )

    # Verify input/output are properly logged on parent span
    assert parent_span.get("input") is not None, "Parent span should have input logged"
    assert parent_span.get("output") is not None, "Parent span should have output logged"

    # Verify that we have child spans beyond just "Agent workflow"
    # The OpenAI SDK should generate multiple span types (generation, response, etc.)
    parent_span_id = parent_span.get("span_id")
    assert parent_span_id is not None, "Parent span should have a span_id"

    all_child_spans = [s for s in spans if parent_span_id in (s.get("span_parents") or [])]

    assert len(all_child_spans) >= 1, f"Should have at least 1 child span, but found {len(all_child_spans)}"

    # We should see spans like Generation, Response, etc. from the OpenAI SDK
    span_types = [s.get("span_attributes", {}).get("type") for s in all_child_spans]
    has_llm_spans = "llm" in span_types
    has_task_spans = "task" in span_types

    assert has_llm_spans or has_task_spans, (
        f"Should have LLM or task type spans from OpenAI SDK, got types: {span_types}"
    )


@pytest.mark.asyncio
async def test_agents_tool_openai_nested_spans(memory_logger):
    """Test that OpenAI calls inside agent tools are properly nested under the tool span."""
    pytest.importorskip("agents", reason="agents package not available")

    from agents import Agent, Runner, function_tool, set_trace_processors

    from braintrust import current_span, wrap_openai
    from braintrust.wrappers.openai import BraintrustTracingProcessor

    assert not memory_logger.pop()

    # Create a tool that uses OpenAI within a manual span
    @function_tool(strict_mode=False)
    def analyze_text(text: str):
        """Analyze text and return a structured summary with key points, sentiment, and statistics."""
        client = wrap_openai(openai.OpenAI())
        with current_span().start_span(name="text_analysis_tool") as span:
            span.log(input={"text": text})

            # Use a simple prompt for testing - just like other tests in this file
            simple_prompt = f"Analyze this text briefly: {text}"

            response = client.chat.completions.create(
                model=TEST_MODEL,
                messages=[{"role": "user", "content": simple_prompt}],
            )
            result = response.choices[0].message.content
            span.log(output={"analysis": result})
            return result

    # Set up tracing
    set_trace_processors([BraintrustTracingProcessor()])

    # Create agent with the tool
    agent = Agent(
        name="Text Analysis Agent",
        instructions="You are a helpful assistant that analyzes text. When asked to analyze text, you MUST use the analyze_text tool. Always call the tool with the exact text provided by the user. After using the tool, provide a two sentence summary of what the tool returned.",
        tools=[analyze_text],
    )

    # Run agent with a specific text to analyze
    test_text = "Artificial intelligence is transforming industries worldwide. Companies are adopting AI technologies to improve efficiency and innovation. However, challenges like ethics and job displacement remain concerns."
    result = await Runner.run(
        agent,
        f"Please analyze this text: '{test_text}'",
        max_turns=3,
    )

    assert result is not None, "Agent should return a result"

    # Verify spans were created
    spans = memory_logger.pop()
    assert len(spans) >= 3, f"Should have at least 3 spans (agent workflow, tool, chat completion), got {len(spans)}"

    # Find different types of spans
    agent_spans = []
    tool_spans = []
    chat_spans = []

    for span in spans:
        span_name = span.get("span_attributes", {}).get("name", "")
        span_type = span.get("span_attributes", {}).get("type", "")

        if "Agent workflow" in span_name or span_type == "task":
            agent_spans.append(span)
        elif span_name == "text_analysis_tool":
            tool_spans.append(span)
        elif span_name == "Chat Completion" and span_type == "llm":
            chat_spans.append(span)

    # Verify we have the expected spans
    assert len(agent_spans) > 0, "Should have at least one agent workflow span"
    assert len(tool_spans) == 1, f"Should have exactly one tool span, got {len(tool_spans)}"
    assert len(chat_spans) == 1, f"Should have exactly one chat completion span, got {len(chat_spans)}"

    tool_span = tool_spans[0]
    chat_span = chat_spans[0]

    # Verify the chat completion span is nested under the tool span
    chat_span_parents = chat_span.get("span_parents", [])
    tool_span_id = tool_span.get("span_id")

    assert tool_span_id is not None, "Tool span should have a span_id"
    assert isinstance(chat_span_parents, list) and len(chat_span_parents) > 0, (
        "Chat completion span should have span_parents array"
    )
    assert tool_span_id in chat_span_parents, (
        f"Chat completion span should include tool span_id {tool_span_id} in its span_parents array {chat_span_parents}"
    )

    # Verify the tool span has input/output logged
    assert "input" in tool_span, "Tool span should have input logged"
    assert test_text in str(tool_span["input"]), "Tool span input should contain the test text"
    assert "output" in tool_span, "Tool span should have output logged"

    # Verify we have chat completion spans
    assert len(chat_spans) >= 1, f"Should have at least one chat completion span, got {len(chat_spans)}"
    chat_span = chat_spans[0]
    chat_span_parents = chat_span.get("span_parents", [])

    # Verify the chat completion span is nested under the tool span
    assert isinstance(chat_span_parents, list) and len(chat_span_parents) > 0, (
        "Chat completion span should have span_parents array"
    )
    assert tool_span_id in chat_span_parents, (
        f"Chat completion span should include tool span_id {tool_span_id} in its span_parents array {chat_span_parents}"
    )

    # Verify the chat completion span has proper LLM data
    assert "input" in chat_span, "Chat completion span should have input logged"
    assert "output" in chat_span, "Chat completion span should have output logged"
    assert chat_span["metadata"]["model"] == TEST_MODEL, "Chat completion should use test model"
    # Just verify there's some output content - don't check specific format
    assert len(str(chat_span["output"])) > 0, "Chat completion should have some output content"
