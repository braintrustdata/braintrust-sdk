from unittest.mock import ANY

import pytest
from braintrust import flush
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate

from braintrust_langchain import BraintrustCallbackHandler
from braintrust_langchain.context import set_global_handler
from tests.conftest import LoggerMemoryLogger
from tests.helpers import assert_matches_object

PROJECT_NAME = "langchain-anthropic"
MODEL = "claude-sonnet-4-20250514"


@pytest.mark.vcr
def test_langchain_anthropic_integration(
    logger_memory_logger: LoggerMemoryLogger,
):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)
    set_global_handler(handler)

    prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")
    model = ChatAnthropic(model_name=MODEL)

    chain = prompt | model

    result = chain.invoke({"number": "2"})

    flush()

    assert isinstance(result.content, str)
    assert "3" in result.content.lower()

    spans = memory_logger.pop()
    assert len(spans) > 0

    chain_spans = [span for span in spans if "LangGraph" in span["span_attributes"].get("name", "")]
    if not chain_spans:
        chain_spans = [span for span in spans if span["span_attributes"].get("type") == "task"]

    llm_spans = [span for span in spans if span["span_attributes"].get("type") == "llm"]
    assert len(llm_spans) > 0, "Should have at least one LLM call"

    llm_span = llm_spans[0]
    assert llm_span["metadata"]["model"] == MODEL

    prompt_spans = [span for span in spans if "ChatPromptTemplate" in span["span_attributes"].get("name", "")]
    if prompt_spans:
        prompt_span = prompt_spans[0]
        assert "input" in prompt_span
        assert prompt_span["input"]["number"] == "2"

    for span in llm_spans:
        if "output" in span:
            output_text = str(span["output"])
            if "3" in output_text.lower():
                break
    else:
        assert False, "No LLM span contained the expected answer '3'"

    assert_matches_object(
        llm_span["metrics"],
        {
            "completion_tokens": 13,
            "end": ANY,
            "prompt_tokens": 16,
            "start": ANY,
            "total_tokens": 29,
        },
    )


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_async_langchain_invoke(
    logger_memory_logger: LoggerMemoryLogger,
):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)
    set_global_handler(handler)

    prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")
    model = ChatAnthropic(model_name=MODEL)

    chain = prompt | model

    result = await chain.ainvoke({"number": "2"})

    flush()

    assert isinstance(result.content, str)
    assert "3" in result.content.lower()

    spans = memory_logger.pop()
    assert len(spans) > 0
