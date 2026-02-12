"""Test that braintrust's pydantic_ai integration works alongside logfire.

Reproduces https://github.com/braintrustdata/braintrust-sdk/issues/1324:
setup_pydantic_ai() conflicts with logfire's instrument_pydantic_ai() when
an agent is created without a model parameter.
"""

import time

import pytest
from braintrust import logger, setup_pydantic_ai
from braintrust.span_types import SpanTypeAttribute
from braintrust.test_helpers import init_test_logger
from pydantic_ai import Agent, ModelSettings

PROJECT_NAME = "test-pydantic-ai-logfire"
MODEL = "openai:gpt-4o-mini"
TEST_PROMPT = "What is 2+2? Answer with just the number."


@pytest.fixture(scope="module", autouse=True)
def setup_wrapper():
    """Setup pydantic_ai wrapper and logfire before any tests run."""
    import logfire

    logfire.configure(send_to_logfire=False)
    logfire.instrument_pydantic_ai()
    setup_pydantic_ai(project_name=PROJECT_NAME)
    yield


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_no_model_agent_run_with_logfire(memory_logger):
    """Agent created without a model should produce spans when model is passed at runtime.

    This is the core scenario from issue #1324: logfire's instrument_pydantic_ai()
    is active alongside setup_pydantic_ai(), and the agent has no model set at
    construction time.
    """
    assert not memory_logger.pop()

    agent = Agent(model_settings=ModelSettings(max_tokens=50))

    start = time.time()
    result = await agent.run(TEST_PROMPT, model=MODEL)
    end = time.time()

    assert result.output
    assert "4" in str(result.output)

    spans = memory_logger.pop()
    assert len(spans) == 2, f"Expected 2 spans (agent_run + chat), got {len(spans)}"

    agent_span = next((s for s in spans if "agent_run" in s["span_attributes"]["name"]), None)
    chat_span = next((s for s in spans if "chat" in s["span_attributes"]["name"]), None)

    assert agent_span is not None, "agent_run span not found"
    assert chat_span is not None, "chat span not found"

    assert agent_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert agent_span["metadata"]["model"] == "gpt-4o-mini"
    assert agent_span["metadata"]["provider"] == "openai"
    assert TEST_PROMPT in str(agent_span["input"])
    assert "4" in str(agent_span["output"])

    assert chat_span["span_parents"] == [agent_span["span_id"]]
    assert chat_span["span_attributes"]["type"] == SpanTypeAttribute.LLM
    assert chat_span["metadata"]["model"] == "gpt-4o-mini"
