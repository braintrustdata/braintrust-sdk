from typing import Dict, List, cast

import pytest
import responses
from braintrust.wrappers.langchain import BraintrustTracer
from langchain.prompts import ChatPromptTemplate
from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableSerializable
from langchain_openai import ChatOpenAI

from ..helpers import assert_matches_object
from .fixtures import CHAT_MATH, logs, mock_braintrust, setup
from .helpers import logs_to_spans, mock_openai
from .types import LogRequest


@pytest.mark.focus
@responses.activate
def test_llm_calls(logs: List[LogRequest]):
    with mock_openai(CHAT_MATH):
        handler = BraintrustTracer()
        prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")
        model = ChatOpenAI(model="gpt-4o-mini", temperature=1, top_p=1, frequency_penalty=0, presence_penalty=0, n=1)
        chain: RunnableSerializable[Dict[str, str], BaseMessage] = prompt | model
        chain.invoke({"number": "2"}, config={"callbacks": [cast(BaseCallbackHandler, handler)]})

    spans, root_span_id, _ = logs_to_spans(logs)

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
