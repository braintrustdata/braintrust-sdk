import asyncio
import time

import litellm
import pytest
from braintrust import logger
from braintrust.test_helpers import assert_dict_matches, init_test_logger
from braintrust.wrappers.litellm import wrap_litellm
from braintrust.wrappers.test_utils import assert_metrics_are_valid, verify_autoinstrument_script

TEST_ORG_ID = "test-org-litellm-py-tracing"
PROJECT_NAME = "test-project-litellm-py-tracing"
TEST_MODEL = "gpt-4o-mini"  # cheapest model for tests
TEST_PROMPT = "What's 12 + 12?"
TEST_SYSTEM_PROMPT = "You are a helpful assistant that only responds with numbers."


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


@pytest.mark.vcr
def test_litellm_completion_metrics(memory_logger) -> None:
    assert not memory_logger.pop()

    # Test unwrapped client first
    response = litellm.completion(model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}])
    assert response
    assert response.choices[0].message.content
    assert "24" in response.choices[0].message.content or "twenty-four" in response.choices[0].message.content.lower()

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    response = wrapped_litellm.completion(model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}])
    end = time.time()

    assert response
    assert response.choices[0].message.content
    assert "24" in response.choices[0].message.content or "twenty-four" in response.choices[0].message.content.lower()

    # Verify spans were created with wrapped client
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "litellm"
    assert TEST_PROMPT in str(span["input"])


@pytest.mark.asyncio
async def test_litellm_acompletion_metrics(memory_logger):
    assert not memory_logger.pop()

    # Test unwrapped client first
    response = await litellm.acompletion(model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}])
    assert response
    assert response.choices[0].message.content
    assert "24" in response.choices[0].message.content or "twenty-four" in response.choices[0].message.content.lower()

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    response = await wrapped_litellm.acompletion(model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}])
    end = time.time()

    assert response
    assert response.choices[0].message.content
    assert "24" in response.choices[0].message.content or "twenty-four" in response.choices[0].message.content.lower()

    # Verify spans were created with wrapped client
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "litellm"
    assert TEST_PROMPT in str(span["input"])


@pytest.mark.vcr
def test_litellm_completion_streaming_sync(memory_logger):
    assert not memory_logger.pop()

    # Test unwrapped client first
    stream = litellm.completion(
        model=TEST_MODEL,
        messages=[{"role": "user", "content": TEST_PROMPT}],
        stream=True,
    )

    chunks = []
    for chunk in stream:
        chunks.append(chunk)

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

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    stream = wrapped_litellm.completion(
        model=TEST_MODEL,
        messages=[{"role": "user", "content": TEST_PROMPT}],
        stream=True,
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

    # Verify spans were created with wrapped client
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "litellm"
    assert TEST_PROMPT in str(span["input"])
    assert "24" in str(span["output"]) or "twenty-four" in str(span["output"]).lower()


@pytest.mark.asyncio
async def test_litellm_acompletion_streaming_async(memory_logger):
    assert not memory_logger.pop()

    # Test unwrapped client first
    stream = await litellm.acompletion(
        model=TEST_MODEL,
        messages=[{"role": "user", "content": TEST_PROMPT}],
        stream=True,
    )

    chunks = []
    async for chunk in stream:
        chunks.append(chunk)

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

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    stream = await wrapped_litellm.acompletion(
        model=TEST_MODEL,
        messages=[{"role": "user", "content": TEST_PROMPT}],
        stream=True,
    )

    chunks = []
    async for chunk in stream:
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

    # Verify spans were created with wrapped client
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "litellm"
    assert TEST_PROMPT in str(span["input"])
    assert "24" in str(span["output"]) or "twenty-four" in str(span["output"]).lower()


@pytest.mark.vcr
def test_litellm_responses_metrics(memory_logger):
    assert not memory_logger.pop()

    # Test unwrapped client first
    response = litellm.responses(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        instructions="Just the number please",
    )
    assert response
    assert response.output
    assert len(response.output) > 0
    unwrapped_content = response.output[0].content[0].text

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    response = wrapped_litellm.responses(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        instructions="Just the number please",
    )
    end = time.time()

    assert response
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
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "litellm"
    assert TEST_PROMPT in str(span["input"])


@pytest.mark.asyncio
async def test_litellm_aresponses_metrics(memory_logger):
    assert not memory_logger.pop()

    # Test unwrapped client first
    response = await litellm.aresponses(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        instructions="Just the number please",
    )
    assert response
    assert response.output
    assert len(response.output) > 0
    unwrapped_content = response.output[0].content[0].text

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    response = await wrapped_litellm.aresponses(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        instructions="Just the number please",
    )
    end = time.time()

    assert response
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
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "litellm"
    assert TEST_PROMPT in str(span["input"])


def test_litellm_embeddings(memory_logger):
    assert not memory_logger.pop()

    # Test unwrapped client first
    response = litellm.embedding(model="text-embedding-ada-002", input="This is a test")
    assert response
    assert response.data
    assert response.data[0]["embedding"]

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    response = wrapped_litellm.embedding(model="text-embedding-ada-002", input="This is a test")
    end = time.time()

    assert response
    assert response.data
    assert response.data[0]["embedding"]

    # Verify spans were created with wrapped client
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    assert span["metadata"]["model"] == "text-embedding-ada-002"
    assert span["metadata"]["provider"] == "litellm"
    assert "This is a test" in str(span["input"])


@pytest.mark.vcr
def test_litellm_moderation(memory_logger):
    assert not memory_logger.pop()

    # Test unwrapped client first
    response = litellm.moderation(model="text-moderation-latest", input="This is a test message")
    assert response
    assert response.results

    # No spans should be generated with unwrapped client
    assert not memory_logger.pop()

    # Now test with wrapped client
    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    response = wrapped_litellm.moderation(model="text-moderation-latest", input="This is a test message")
    end = time.time()

    assert response
    assert response.results

    # Verify spans were created with wrapped client
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert span["metadata"]["model"] == "text-moderation-latest"
    assert span["metadata"]["provider"] == "litellm"
    assert "This is a test message" in str(span["input"])


@pytest.mark.vcr
def test_litellm_completion_with_system_prompt(memory_logger):
    assert not memory_logger.pop()

    wrapped_litellm = wrap_litellm(litellm)

    response = wrapped_litellm.completion(
        model=TEST_MODEL,
        messages=[{"role": "system", "content": TEST_SYSTEM_PROMPT}, {"role": "user", "content": TEST_PROMPT}],
    )

    assert response
    assert response.choices
    assert "24" in response.choices[0].message.content

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
async def test_litellm_acompletion_with_system_prompt(memory_logger):
    assert not memory_logger.pop()

    wrapped_litellm = wrap_litellm(litellm)

    response = await wrapped_litellm.acompletion(
        model=TEST_MODEL,
        messages=[{"role": "system", "content": TEST_SYSTEM_PROMPT}, {"role": "user", "content": TEST_PROMPT}],
    )

    assert response
    assert response.choices
    assert "24" in response.choices[0].message.content

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
def test_litellm_completion_error(memory_logger):
    assert not memory_logger.pop()

    wrapped_litellm = wrap_litellm(litellm)

    # Use a non-existent model to force an error
    fake_model = "non-existent-model"

    try:
        wrapped_litellm.completion(model=fake_model, messages=[{"role": "user", "content": TEST_PROMPT}])
        pytest.fail("Expected an exception but none was raised")
    except Exception:
        # We expect an error here
        pass

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert log["project_id"] == PROJECT_NAME
    # Check that we got a log entry with the fake model
    assert fake_model in str(log)


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_litellm_acompletion_error(memory_logger):
    assert not memory_logger.pop()

    wrapped_litellm = wrap_litellm(litellm)

    # Use a non-existent model to force an error
    fake_model = "non-existent-model"

    try:
        await wrapped_litellm.acompletion(model=fake_model, messages=[{"role": "user", "content": TEST_PROMPT}])
        pytest.fail("Expected an exception but none was raised")
    except Exception:
        # We expect an error here
        pass

    logs = memory_logger.pop()
    assert len(logs) == 1
    log = logs[0]
    assert log["project_id"] == PROJECT_NAME
    # Check that we got a log entry with the fake model
    assert fake_model in str(log)


@pytest.mark.asyncio
async def test_litellm_async_parallel_requests(memory_logger):
    """Test multiple parallel async requests with the wrapped client."""
    assert not memory_logger.pop()

    wrapped_litellm = wrap_litellm(litellm)

    # Create multiple prompts
    prompts = [f"What is {i} + {i}?" for i in range(3, 6)]

    # Run requests in parallel
    tasks = [
        wrapped_litellm.acompletion(model=TEST_MODEL, messages=[{"role": "user", "content": prompt}])
        for prompt in prompts
    ]

    # Wait for all to complete
    results = await asyncio.gather(*tasks)

    # Check all results
    assert len(results) == 3
    for result in results:
        assert result.choices[0].message.content

    # Check that all spans were created
    spans = memory_logger.pop()
    assert len(spans) == 3

    # Verify each span has proper data
    for i, span in enumerate(spans):
        assert span["metadata"]["model"] == TEST_MODEL
        assert span["metadata"]["provider"] == "litellm"
        assert prompts[i] in str(span["input"])
        assert_metrics_are_valid(span["metrics"])


@pytest.mark.vcr
def test_litellm_tool_calls(memory_logger):
    """Test tool calls with LiteLLM."""
    assert not memory_logger.pop()

    # Define tools that can be called
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
    ]

    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    response = wrapped_litellm.completion(
        model=TEST_MODEL,
        messages=[{"role": "user", "content": "What's the weather in New York?"}],
        tools=tools,
        temperature=0,
    )
    end = time.time()

    print(response)
    assert response
    assert response.choices

    # Verify spans were created
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]

    # Validate the span structure
    assert_dict_matches(
        span,
        {
            "span_attributes": {"type": "llm", "name": "Completion"},
            "metadata": {
                "model": TEST_MODEL,
                "provider": "litellm",
                "tools": lambda tools_list: len(tools_list) == 1
                and any(tool.get("function", {}).get("name") == "get_weather" for tool in tools_list),
            },
            "input": lambda inp: "What's the weather in New York?" in str(inp),
            "metrics": lambda m: assert_metrics_are_valid(m, start, end) is None,
        },
    )


@pytest.mark.vcr
def test_litellm_responses_streaming_sync(memory_logger):
    """Test the responses API with streaming."""
    assert not memory_logger.pop()

    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    stream = wrapped_litellm.responses(model=TEST_MODEL, input="What's 12 + 12?", stream=True)

    chunks = []
    for chunk in stream:
        if chunk.type == "response.output_text.delta":
            chunks.append(chunk.delta)
    end = time.time()

    output = "".join(chunks)
    assert chunks
    assert len(chunks) > 1
    assert "24" in output

    # Verify the span is created
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert span["metadata"]["stream"] == True
    assert "What's 12 + 12?" in str(span["input"])
    assert "24" in str(span["output"])


@pytest.mark.asyncio
async def test_litellm_aresponses_streaming_async(memory_logger):
    """Test the async responses API with streaming."""
    assert not memory_logger.pop()

    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    stream = await wrapped_litellm.aresponses(model=TEST_MODEL, input="What's 12 + 12?", stream=True)

    chunks = []
    async for chunk in stream:
        if chunk.type == "response.output_text.delta":
            chunks.append(chunk.delta)
    end = time.time()

    output = "".join(chunks)
    assert chunks
    assert len(chunks) > 1
    assert "24" in output

    # Verify the span is created
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    assert span["metadata"]["stream"] == True
    assert "What's 12 + 12?" in str(span["input"])
    assert "24" in str(span["output"])


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_litellm_async_streaming_with_break(memory_logger):
    """Test breaking out of the async streaming loop early."""
    assert not memory_logger.pop()

    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    stream = await wrapped_litellm.acompletion(
        model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}], stream=True
    )

    time.sleep(0.1)  # time to first token sleep

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


@pytest.mark.vcr
def test_patch_litellm_responses(memory_logger):
    """Test that patch_litellm() patches responses."""
    from braintrust.wrappers.litellm import patch_litellm

    assert not memory_logger.pop()

    patch_litellm()
    start = time.time()
    # Call litellm.responses directly (not wrapped_litellm.responses)
    response = litellm.responses(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        instructions="Just the number please",
    )
    end = time.time()

    assert response
    assert response.output
    assert len(response.output) > 0
    content = response.output[0].content[0].text
    assert "24" in content or "twenty-four" in content.lower()

    # Verify span was created
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert_metrics_are_valid(span["metrics"], start, end)
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "litellm"
    assert TEST_PROMPT in str(span["input"])


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_patch_litellm_aresponses(memory_logger):
    """Test that patch_litellm() patches aresponses."""
    from braintrust.wrappers.litellm import patch_litellm

    assert not memory_logger.pop()

    patch_litellm()
    start = time.time()
    # Call litellm.aresponses directly (not wrapped_litellm.aresponses)
    response = await litellm.aresponses(
        model=TEST_MODEL,
        input=TEST_PROMPT,
        instructions="Just the number please",
    )
    end = time.time()

    assert response
    assert response.output
    assert len(response.output) > 0
    content = response.output[0].content[0].text
    assert "24" in content or "twenty-four" in content.lower()

    # Verify span was created
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert_metrics_are_valid(span["metrics"], start, end)
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "litellm"
    assert TEST_PROMPT in str(span["input"])


class TestAutoInstrumentLiteLLM:
    """Tests for auto_instrument() with LiteLLM."""

    def test_auto_instrument_litellm(self):
        """Test auto_instrument patches LiteLLM, creates spans, and uninstrument works."""
        verify_autoinstrument_script("test_auto_litellm.py")
