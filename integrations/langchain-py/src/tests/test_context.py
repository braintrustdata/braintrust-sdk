# pyright: reportTypedDictNotRequiredAccess=none
from typing import Dict

import pytest
from braintrust_langchain import BraintrustCallbackHandler, set_global_handler
from langchain.prompts import ChatPromptTemplate
from langchain_core.callbacks import CallbackManager
from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableSerializable
from langchain_openai import ChatOpenAI

from .conftest import LoggerMemoryLogger
from .helpers import assert_matches_object


@pytest.mark.vcr
def test_global_handler(logger_memory_logger: LoggerMemoryLogger):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger, debug=True)
    set_global_handler(handler)

    # Make sure the handler is registered in the LangChain library
    manager = CallbackManager.configure()
    assert next((h for h in manager.handlers if isinstance(h, BraintrustCallbackHandler)), None) == handler

    # Here's what a typical user would do
    prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")
    model = ChatOpenAI(model="gpt-4o-mini", temperature=1, top_p=1, frequency_penalty=0, presence_penalty=0, n=1)
    chain: RunnableSerializable[Dict[str, str], BaseMessage] = prompt.pipe(model)

    message = chain.invoke({"number": "2"})

    spans = memory_logger.pop()
    assert len(spans) > 0

    root_span_id = spans[0]["span_id"]

    # Spans would be empty if the handler was not registered, let's make sure it logged what we expect
    assert_matches_object(
        spans,
        [
            {
                "span_attributes": {
                    "name": "RunnableSequence",
                    "type": "task",
                },
                "input": {"number": "2"},
                "metadata": {"tags": []},
                "span_id": root_span_id,
                "root_span_id": root_span_id,
            },
            {
                "span_attributes": {"name": "ChatPromptTemplate"},
                "input": {"number": "2"},
                "output": "What is 1 + 2?",
                "metadata": {"tags": ["seq:step:1"]},
                "root_span_id": root_span_id,
                "span_parents": [root_span_id],
            },
            {
                "span_attributes": {"name": "ChatOpenAI", "type": "llm"},
                "input": [
                    {"content": "What is 1 + 2?", "role": "user"},
                ],
                "output": [
                    {"content": "1 + 2 equals 3.", "role": "assistant"},
                ],
                "metadata": {
                    "tags": ["seq:step:2"],
                    "model": "gpt-4o-mini",
                    "temperature": 1,
                    "top_p": 1,
                    "frequency_penalty": 0,
                    "presence_penalty": 0,
                    "n": 1,
                },
                "root_span_id": root_span_id,
                "span_parents": [root_span_id],
            },
        ],
    )

    assert message.content == "1 + 2 equals 3."
