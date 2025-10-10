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
from .helpers import ANY, assert_matches_object, find_spans_by_attributes
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
    assert len(spans) == 3

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
                "output": {
                    "content": ANY,  # LLM response text
                    "additional_kwargs": ANY,
                    "response_metadata": ANY,
                    "type": "ai",
                    "name": ANY,
                    "id": ANY,
                    "example": ANY,
                    "tool_calls": ANY,
                    "invalid_tool_calls": ANY,
                    "usage_metadata": ANY,
                },
                "metadata": {"tags": []},
                "span_id": root_span_id,
                "root_span_id": root_span_id,
            },
            {
                "span_attributes": {"name": "ChatPromptTemplate"},
                "input": {"number": "2"},
                "output": {
                    "messages": [
                        {
                            "content": ANY,  # Formatted prompt text
                            "additional_kwargs": {},
                            "response_metadata": {},
                            "type": "human",
                            "name": None,
                            "id": None,
                        }
                    ]
                },
                "metadata": {"tags": ["seq:step:1"]},
                "root_span_id": root_span_id,
                "span_parents": [root_span_id],
            },
            {
                "span_attributes": {"name": "ChatOpenAI", "type": "llm"},
                "input": [
                    [
                        {
                            "content": ANY,  # Prompt message content
                            "additional_kwargs": {},
                            "response_metadata": {},
                            "type": "human",
                            "name": None,
                            "id": None,
                            "example": ANY,
                        }
                    ]
                ],
                "output": {
                    "generations": [
                        [
                            {
                                "text": ANY,  # Generated text
                                "generation_info": ANY,
                                "type": "ChatGeneration",
                                "message": {
                                    "content": ANY,  # Message content
                                    "additional_kwargs": ANY,
                                    "response_metadata": ANY,
                                    "type": "ai",
                                    "name": None,
                                    "id": ANY,
                                },
                            }
                        ]
                    ],
                    "llm_output": {
                        "token_usage": {
                            "completion_tokens": ANY,
                            "prompt_tokens": ANY,
                            "total_tokens": ANY,
                        },
                        "model_name": "gpt-4o-mini-2024-07-18",
                    },
                    "run": None,
                    "type": "LLMResult",
                },
                "metrics": {
                    "start": ANY,
                    "total_tokens": ANY,
                    "prompt_tokens": ANY,
                    "completion_tokens": ANY,
                    "end": ANY,
                },
                "metadata": {
                    "tags": ["seq:step:2"],
                    "model": "gpt-4o-mini-2024-07-18",
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
    assert len(spans) == 3

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
                "output": {
                    "content": ANY,  # LLM response
                    "additional_kwargs": ANY,
                    "response_metadata": ANY,
                    "type": "ai",
                },
                "metadata": {"tags": ["test"]},
                "span_id": root_span_id,
                "root_span_id": root_span_id,
            },
            {
                "span_attributes": {"name": "ChatPromptTemplate"},
                "input": {"input": "What's your name?", "history": "Assistant: Hello! How can I assist you today?"},
                "output": {
                    "messages": [
                        {
                            "content": ANY,  # Formatted prompt with history
                            "additional_kwargs": {},
                            "response_metadata": {},
                            "type": "human",
                            "name": None,
                            "id": None,
                        }
                    ]
                },
                "metadata": {"tags": ["seq:step:1", "test"]},
                "root_span_id": root_span_id,
                "span_parents": [root_span_id],
            },
            {
                "span_attributes": {"name": "ChatOpenAI", "type": "llm"},
                "input": [
                    [
                        {
                            "content": ANY,  # Prompt with history
                            "additional_kwargs": {},
                            "response_metadata": {},
                            "type": "human",
                            "name": None,
                            "id": None,
                            "example": ANY,
                        }
                    ]
                ],
                "output": {
                    "generations": [
                        [
                            {
                                "text": ANY,  # Generated response
                                "generation_info": ANY,
                                "type": "ChatGeneration",
                                "message": {
                                    "content": ANY,
                                    "additional_kwargs": ANY,
                                    "response_metadata": ANY,
                                    "type": "ai",
                                    "name": None,
                                    "id": ANY,
                                },
                            }
                        ]
                    ],
                    "llm_output": {
                        "token_usage": {
                            "completion_tokens": ANY,
                            "prompt_tokens": ANY,
                            "total_tokens": ANY,
                        },
                        "model_name": "gpt-4o-mini-2024-07-18",
                    },
                    "run": None,
                    "type": "LLMResult",
                },
                "metrics": {
                    "start": ANY,
                    "total_tokens": ANY,
                    "prompt_tokens": ANY,
                    "completion_tokens": ANY,
                    "end": ANY,
                },
                "metadata": {
                    "tags": ["seq:step:2", "test"],
                    "model": "gpt-4o-mini-2024-07-18",
                },
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
                    [
                        {
                            "content": ANY,  # User query
                            "additional_kwargs": {},
                            "response_metadata": {},
                            "type": "human",
                            "name": None,
                            "id": None,
                            "example": ANY,
                        }
                    ]
                ],
                "metadata": {
                    "tags": [],
                    "model": "gpt-4o-mini-2024-07-18",
                    "invocation_params": {
                        "tools": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "calculator",
                                    "description": "Can perform mathematical operations.",
                                    "parameters": ANY,  # Complex JSON schema
                                },
                            }
                        ],
                    },
                },
                "output": {
                    "generations": [
                        [
                            {
                                "generation_info": ANY,
                                "type": "ChatGeneration",
                                "message": {
                                    "content": ANY,  # May be empty for tool calls
                                    "type": "ai",
                                    "additional_kwargs": {
                                        "tool_calls": ANY,  # Tool call details
                                    },
                                    "response_metadata": ANY,
                                    "name": None,
                                    "id": ANY,
                                },
                            }
                        ]
                    ],
                    "llm_output": {
                        "token_usage": {
                            "completion_tokens": ANY,
                            "prompt_tokens": ANY,
                            "total_tokens": ANY,
                        },
                        "model_name": "gpt-4o-mini-2024-07-18",
                    },
                    "run": None,
                    "type": "LLMResult",
                },
                "metrics": {
                    "start": ANY,
                    "total_tokens": ANY,
                    "prompt_tokens": ANY,
                    "completion_tokens": ANY,
                    "end": ANY,
                },
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

    # Verify both LLM spans have expected structure
    for span in llm_spans:
        assert_matches_object(
            span,
            {
                "span_attributes": {"name": "ChatOpenAI", "type": "llm"},
                "metadata": {
                    "tags": ["seq:step:2"],
                    "model": "gpt-4o-mini-2024-07-18",
                },
                "input": [
                    [
                        {
                            "content": ANY,  # Prompt about bears
                            "additional_kwargs": {},
                            "response_metadata": {},
                            "type": "human",
                        }
                    ]
                ],
                "output": {
                    "generations": [
                        [
                            {
                                "text": ANY,  # Generated joke or poem
                                "generation_info": ANY,
                                "type": "ChatGeneration",
                                "message": {
                                    "content": ANY,
                                    "type": "ai",
                                },
                            }
                        ]
                    ],
                    "llm_output": {
                        "token_usage": {
                            "completion_tokens": ANY,
                            "prompt_tokens": ANY,
                            "total_tokens": ANY,
                        },
                        "model_name": "gpt-4o-mini-2024-07-18",
                    },
                    "type": "LLMResult",
                },
                "metrics": {
                    "start": ANY,
                    "total_tokens": ANY,
                    "prompt_tokens": ANY,
                    "completion_tokens": ANY,
                    "end": ANY,
                },
            },
        )


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

    # Find spans by name - langgraph doesn't guarantee ordering
    langgraph_spans = find_spans_by_attributes(spans, name="LangGraph")
    say_hello_spans = find_spans_by_attributes(spans, name="sayHello")
    say_bye_spans = find_spans_by_attributes(spans, name="sayBye")
    llm_spans = find_spans_by_attributes(spans, name="ChatOpenAI")

    # Verify we have the expected spans
    assert len(langgraph_spans) == 1
    assert len(say_hello_spans) == 1
    assert len(say_bye_spans) == 1
    assert len(llm_spans) == 1

    # Verify LangGraph root span
    assert_matches_object(
        langgraph_spans[0],
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
    )

    # Verify sayHello span
    assert_matches_object(
        say_hello_spans[0],
        {
            "span_attributes": {
                "name": "sayHello",
            },
            "input": {},
            "metadata": {
                "tags": ["graph:step:1"],
            },
            "output": ANY,  # String greeting from LLM
        },
    )

    # Verify ChatOpenAI span
    assert_matches_object(
        llm_spans[0],
        {
            "span_attributes": {
                "name": "ChatOpenAI",
                "type": "llm",
            },
            "input": [
                [
                    {
                        "content": ANY,  # "Say hello" prompt
                        "additional_kwargs": {},
                        "response_metadata": {},
                        "type": "human",
                        "name": None,
                        "id": None,
                        "example": ANY,
                    }
                ]
            ],
            "metadata": {
                "model": "gpt-4o-mini-2024-07-18",
                "tags": [],
            },
            "output": {
                "generations": [
                    [
                        {
                            "text": ANY,  # Greeting text
                            "generation_info": ANY,
                            "type": "ChatGeneration",
                            "message": {
                                "content": ANY,
                                "additional_kwargs": ANY,
                                "response_metadata": ANY,
                                "type": "ai",
                                "name": None,
                                "id": ANY,
                            },
                        }
                    ]
                ],
                "llm_output": {
                    "token_usage": {
                        "completion_tokens": ANY,
                        "prompt_tokens": ANY,
                        "total_tokens": ANY,
                    },
                    "model_name": "gpt-4o-mini-2024-07-18",
                },
                "run": None,
                "type": "LLMResult",
            },
            "metrics": {
                "start": ANY,
                "total_tokens": ANY,
                "prompt_tokens": ANY,
                "completion_tokens": ANY,
                "end": ANY,
            },
        },
    )

    # Verify sayBye span
    assert_matches_object(
        say_bye_spans[0],
        {
            "span_attributes": {
                "name": "sayBye",
            },
            "input": ANY,  # String from previous step
            "metadata": {
                "tags": ["graph:step:2"],
            },
            "output": "Bye",
        },
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
                    "input3": None,
                },
                "metadata": {
                    "tags": ["test"],
                },
                "output": {
                    "output1": "value1",
                    "output2": None,
                    "output3": None,
                },
            },
        ],
    )
