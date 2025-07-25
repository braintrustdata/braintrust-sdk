# pyright: reportUnknownVariableType=none
# pyright: reportUnknownArgumentType=none
# pyright: reportUnknownMemberType=none
# pyright: reportTypedDictNotRequiredAccess=none
from typing import List

import responses
from braintrust_langchain import BraintrustCallbackHandler, set_global_handler
from langchain.prompts import ChatPromptTemplate
from langchain_core.callbacks import CallbackManager
from langchain_openai import ChatOpenAI

from .fixtures import (
    CHAT_MATH,
    logs,  # noqa: F401 # type: ignore[reportUnusedImport]
    mock_braintrust,  # noqa: F401 # type: ignore[reportUnusedImport]
    setup,  # noqa: F401 # type: ignore[reportUnusedImport]
)
from .helpers import assert_matches_object, logs_to_spans, mock_openai
from .types import LogRequest


@responses.activate
def test_global_handler(logs: List[LogRequest]):
    handler = BraintrustCallbackHandler(debug=True)
    set_global_handler(handler)

    # Make sure the handler is registered in the LangChain library
    manager = CallbackManager.configure()
    assert next((h for h in manager.handlers if isinstance(h, BraintrustCallbackHandler)), None) == handler

    with mock_openai([CHAT_MATH]):
        # Here's what a typical user would do
        prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")
        model = ChatOpenAI(model="gpt-4o-mini", temperature=1, top_p=1, frequency_penalty=0, presence_penalty=0, n=1)
        chain = prompt.pipe(model)

        message = chain.invoke({"number": "2"})

    spans, root_span_id, _ = logs_to_spans(logs)

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
