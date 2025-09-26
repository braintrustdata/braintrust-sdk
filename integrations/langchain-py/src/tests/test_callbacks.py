# pyright: reportTypedDictNotRequiredAccess=none
import uuid
from typing import Dict, List, Union, cast

import pytest
from braintrust.logger import flush
from braintrust_langchain import BraintrustCallbackHandler
from langchain.prompts import ChatPromptTemplate
from langchain.prompts.prompt import PromptTemplate
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableMap, RunnableSerializable
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from .conftest import LoggerMemoryLogger
from .helpers import assert_matches_object, find_spans_by_attributes
from .types import Span


@pytest.mark.vcr
def test_llm_calls(logger_memory_logger: LoggerMemoryLogger):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)
    prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")
    model = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=1,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        n=1,
    )
    chain: RunnableSerializable[Dict[str, str], BaseMessage] = prompt.pipe(model)
    chain.invoke({"number": "2"}, config={"callbacks": [cast(BaseCallbackHandler, handler)]})

    spans = memory_logger.pop()
    assert len(spans) > 0

    root_span_id = spans[0]["span_id"]

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
                    "model": "gpt-4o-mini-2024-07-18",
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


@pytest.mark.vcr
def test_chain_with_memory(logger_memory_logger: LoggerMemoryLogger):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)
    prompt = ChatPromptTemplate.from_template("{history} User: {input}")
    model = ChatOpenAI(model="gpt-4o-mini")
    chain: RunnableSerializable[Dict[str, str], BaseMessage] = prompt.pipe(model)

    memory = {"history": "Assistant: Hello! How can I assist you today?"}
    chain.invoke(
        {"input": "What's your name?", **memory},
        config={"callbacks": [cast(BaseCallbackHandler, handler)], "tags": ["test"]},
    )

    spans = memory_logger.pop()
    root_span_id = spans[0]["span_id"]

    assert_matches_object(
        spans,
        [
            {
                "span_attributes": {
                    "name": "RunnableSequence",
                    "type": "task",
                },
                "input": {"input": "What's your name?", "history": "Assistant: Hello! How can I assist you today?"},
                "metadata": {"tags": ["test"]},
                "span_id": root_span_id,
                "root_span_id": root_span_id,
            },
            {
                "span_attributes": {"name": "ChatPromptTemplate"},
                "input": {"input": "What's your name?", "history": "Assistant: Hello! How can I assist you today?"},
                "output": "Assistant: Hello! How can I assist you today? User: What's your name?",
                "metadata": {"tags": ["seq:step:1", "test"]},
                "root_span_id": root_span_id,
                "span_parents": [root_span_id],
            },
            {
                "span_attributes": {"name": "ChatOpenAI", "type": "llm"},
                "input": [
                    {
                        "content": "Assistant: Hello! How can I assist you today? User: What's your name?",
                        "role": "user",
                    },
                ],
                "output": [
                    {
                        "content": "Assistant: I don't have a personal name, but you can call me Assistant. How can I help you today?",
                        "role": "assistant",
                    },
                ],
                "metadata": {"tags": ["seq:step:2", "test"], "model": "gpt-4o-mini-2024-07-18"},
                "root_span_id": root_span_id,
                "span_parents": [root_span_id],
            },
        ],
    )


@pytest.mark.vcr
def test_tool_usage(logger_memory_logger: LoggerMemoryLogger):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)

    class CalculatorInput(BaseModel):
        operation: str = Field(
            description="The type of operation to execute.",
            json_schema_extra={"enum": ["add", "subtract", "multiply", "divide"]},
        )
        number1: float = Field(description="The first number to operate on.")
        number2: float = Field(description="The second number to operate on.")

    @tool
    def calculator(input: CalculatorInput) -> str:
        """Can perform mathematical operations."""
        if input.operation == "add":
            return str(input.number1 + input.number2)
        elif input.operation == "subtract":
            return str(input.number1 - input.number2)
        elif input.operation == "multiply":
            return str(input.number1 * input.number2)
        elif input.operation == "divide":
            return str(input.number1 / input.number2)
        else:
            raise ValueError("Invalid operation.")

    model = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=1,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        n=1,
    )
    model_with_tools = model.bind_tools([calculator])
    model_with_tools.invoke("What is 3 * 12", config={"callbacks": [cast(BaseCallbackHandler, handler)]})

    spans = memory_logger.pop()
    root_span_id = spans[0]["span_id"]

    assert_matches_object(
        spans,
        [
            {
                "span_id": root_span_id,
                "root_span_id": root_span_id,
                "span_attributes": {
                    "name": "ChatOpenAI",
                    "type": "llm",
                },
                "input": [
                    {
                        "content": "What is 3 * 12",
                        "role": "user",
                    },
                ],
                "metadata": {
                    "tags": [],
                    "model": "gpt-4o-mini-2024-07-18",
                    "temperature": 1,
                    "top_p": 1,
                    "frequency_penalty": 0,
                    "presence_penalty": 0,
                    "n": 1,
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "description": "Can perform mathematical operations.",
                                "name": "calculator",
                                "parameters": {
                                    "properties": {
                                        "input": {
                                            "properties": {
                                                "number1": {
                                                    "description": "The first number to operate on.",
                                                    "type": "number",
                                                },
                                                "number2": {
                                                    "description": "The second number to operate on.",
                                                    "type": "number",
                                                },
                                                "operation": {
                                                    "description": "The type of operation to execute.",
                                                    "enum": ["add", "subtract", "multiply", "divide"],
                                                    "type": "string",
                                                },
                                            },
                                            "required": ["operation", "number1", "number2"],
                                            "type": "object",
                                        }
                                    },
                                    "required": ["input"],
                                    "type": "object",
                                },
                            },
                        }
                    ],
                },
                "output": [
                    {
                        "content": "",
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "name": "calculator",
                                "args": {"input": {"operation": "multiply", "number1": 3, "number2": 12}},
                                "type": "tool_call",
                            }
                        ],
                    }
                ],
            }
        ],
    )


@pytest.mark.vcr
@pytest.mark.skip(reason="Not yet working with VCR.")
def test_parallel_execution(logger_memory_logger: LoggerMemoryLogger):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)

    model = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=1,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        n=1,
    )

    joke_chain = PromptTemplate.from_template("Tell me a joke about {topic}").pipe(model)
    poem_chain = PromptTemplate.from_template("write a 2-line poem about {topic}").pipe(model)

    map_chain = RunnableMap(
        {
            "joke": joke_chain,
            "poem": poem_chain,
        }
    )

    map_chain.invoke({"topic": "bear"}, config={"callbacks": [cast(BaseCallbackHandler, handler)]})

    spans = cast(List[Span], memory_logger.pop())

    # Find the LLM spans
    llm_spans = find_spans_by_attributes(spans, name="ChatOpenAI")
    assert len(llm_spans) == 2

    # Find the specific spans for joke and poem by matching their input content
    joke_llm_span = next((s for s in llm_spans if "Tell me a joke about bear" in s["input"][0]["content"]), None)
    poem_llm_span = next((s for s in llm_spans if "write a 2-line poem about bear" in s["input"][0]["content"]), None)

    # Check that we found both spans
    assert joke_llm_span is not None, "Could not find joke LLM span"
    assert poem_llm_span is not None, "Could not find poem LLM span"

    # Verify common metadata for both spans
    for span in [joke_llm_span, poem_llm_span]:
        assert span["metadata"]["tags"] == ["seq:step:2"]
        assert span["metadata"]["model"] == "gpt-4o-mini-2024-07-18"
        assert span["metadata"]["temperature"] == 1
        assert span["metadata"]["top_p"] == 1
        assert span["metadata"]["frequency_penalty"] == 0
        assert span["metadata"]["presence_penalty"] == 0
        assert span["metadata"]["n"] == 1

    # Just verify that both outputs exist and are non-empty strings
    assert joke_llm_span["output"][0]["content"]
    assert poem_llm_span["output"][0]["content"]

    # Optionally check that outputs contain expected keywords
    assert "bear" in joke_llm_span["output"][0]["content"].lower() or "joke" in joke_llm_span["output"][0]["role"]
    assert "bear" in poem_llm_span["output"][0]["content"].lower() or "poem" in poem_llm_span["output"][0]["role"]


@pytest.mark.vcr
def test_langgraph_state_management(logger_memory_logger: LoggerMemoryLogger):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    try:
        from langgraph.graph import END, START, StateGraph
    except ImportError:
        pytest.skip("langgraph not installed")

    handler = BraintrustCallbackHandler(logger=logger)
    model = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=1,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        n=1,
    )

    def say_hello(state: Dict[str, str]):
        response = model.invoke("Say hello")
        return cast(Union[str, List[str], Dict[str, str]], response.content)

    def say_bye(state: Dict[str, str]):
        print("From the 'sayBye' node: Bye world!")
        return "Bye"

    workflow = (
        StateGraph(state_schema=Dict[str, str])
        .add_node("sayHello", say_hello)
        .add_node("sayBye", say_bye)
        .add_edge(START, "sayHello")
        .add_edge("sayHello", "sayBye")
        .add_edge("sayBye", END)
    )

    graph = workflow.compile()
    graph.invoke({}, config={"callbacks": [handler]})

    spans = memory_logger.pop()

    assert_matches_object(
        spans,
        [
            {
                "span_attributes": {
                    "name": "LangGraph",
                    "type": "task",
                },
                "input": {},
                "metadata": {
                    "tags": [],
                },
                "output": "Bye",
            },
            {
                "span_attributes": {
                    "name": "sayHello",
                },
                "input": {},
                "metadata": {
                    "tags": ["graph:step:1"],
                },
                "output": "Hello! How can I assist you today?",
            },
            {
                "span_attributes": {
                    "name": "ChatOpenAI",
                    "type": "llm",
                },
                "input": [
                    {
                        "content": "Say hello",
                        "role": "user",
                    },
                ],
                "metadata": {
                    "model": "gpt-4o-mini-2024-07-18",
                    "temperature": 1,
                    "top_p": 1,
                    "frequency_penalty": 0,
                    "presence_penalty": 0,
                    "n": 1,
                    "tags": [],
                },
                "output": [
                    {
                        "content": "Hello! How can I assist you today?",
                        "role": "assistant",
                    },
                ],
            },
            {
                "span_attributes": {
                    "name": "sayBye",
                },
                "input": "Hello! How can I assist you today?",
                "metadata": {
                    "tags": ["graph:step:2"],
                },
                "output": "Bye",
            },
        ],
        # langgraph doesn't guarantee span ordering
        ignore_order=True,
    )


@pytest.mark.vcr
def test_chain_null_values(logger_memory_logger: LoggerMemoryLogger):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)

    run_id = uuid.UUID("f81d4fae-7dec-11d0-a765-00a0c91e6bf6")

    handler.on_chain_start(
        {"id": ["TestChain"], "lc": 1, "type": "not_implemented"},
        {"input1": "value1", "input2": None, "input3": None},
        run_id=run_id,
        parent_run_id=None,
        tags=["test"],
    )

    handler.on_chain_end(
        {"output1": "value1", "output2": None, "output3": None},
        run_id=run_id,
        parent_run_id=None,
        tags=["test"],
    )

    flush()

    spans = memory_logger.pop()
    root_span_id = spans[0]["span_id"]

    assert_matches_object(
        spans,
        [
            {
                "root_span_id": root_span_id,
                "span_attributes": {
                    "name": "TestChain",
                    "type": "task",
                },
                "input": {
                    "input1": "value1",
                    "input2": None,
                },
                "metadata": {
                    "tags": ["test"],
                },
                "output": {
                    "output1": "value1",
                    "output2": None,
                },
            },
        ],
    )
