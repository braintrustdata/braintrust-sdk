# pyright: reportTypedDictNotRequiredAccess=none
import uuid
from typing import Dict, List, Union, cast

import pytest
from braintrust.logger import flush
from langchain_anthropic import ChatAnthropic
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.prompts.prompt import PromptTemplate
from langchain_core.runnables import RunnableMap, RunnableSerializable
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from braintrust_langchain import BraintrustCallbackHandler

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


def test_consecutive_eval_calls(logger_memory_logger: LoggerMemoryLogger):
    from braintrust import Eval

    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    def task_fn(input, hooks):
        # Create handler that will log LangChain spans
        handler = BraintrustCallbackHandler(logger=logger)

        # Simulate LangChain chain execution by manually triggering callbacks
        run_id = uuid.uuid4()

        handler.on_chain_start(
            {"id": ["RunnableSequence"], "lc": 1, "type": "not_implemented"},
            {"number": str(input)},
            run_id=run_id,
            parent_run_id=None,
        )

        # Simulate output
        output = f"Result for {input}"

        handler.on_chain_end(
            {"content": output},
            run_id=run_id,
            parent_run_id=None,
        )

        return output

    # Create a parent span to hold the eval
    with logger.start_span(name="test-consecutive-eval", span_attributes={"type": "eval"}) as parent_span:
        # Run Eval with consecutive calls using parent parameter
        Eval(
            "test-consecutive-eval",
            data=[{"input": 1, "expected": "Result for 1"}, {"input": 2, "expected": "Result for 2"}],
            task=task_fn,
            scores=[],
            parent=parent_span.id,
        )

    flush()

    spans = memory_logger.pop()

    # Verify we have the expected number of spans:
    # 1 root eval span + 2 eval dataset record spans + 2 task spans = 5 total
    assert len(spans) == 5, f"Expected 5 spans, got {len(spans)}"

    # Find the root eval span
    root_eval_span = [s for s in spans if s.get("span_attributes", {}).get("name") == "test-consecutive-eval"][0]
    root_eval_span_id = root_eval_span["span_id"]

    # Find the eval dataset record spans (direct children of root eval span)
    eval_record_spans = [
        s
        for s in spans
        if s.get("span_attributes", {}).get("name") == "eval" and root_eval_span_id in (s.get("span_parents") or [])
    ]
    assert len(eval_record_spans) == 2, f"Expected 2 eval record spans, got {len(eval_record_spans)}"

    # Sort by input
    eval_record_spans_sorted = sorted(eval_record_spans, key=lambda s: s.get("input", 0))
    eval_record_1 = eval_record_spans_sorted[0]
    eval_record_2 = eval_record_spans_sorted[1]

    # Find the task spans (children of eval record spans)
    task_spans = [s for s in spans if s.get("span_attributes", {}).get("name") == "task"]
    assert len(task_spans) == 2, f"Expected 2 task spans, got {len(task_spans)}"

    # Sort by input
    task_spans_sorted = sorted(task_spans, key=lambda s: s.get("input", 0))
    task_1_span = task_spans_sorted[0]
    task_2_span = task_spans_sorted[1]

    # Verify root eval span structure
    assert_matches_object(
        [root_eval_span],
        [
            {
                "span_id": root_eval_span_id,
                "root_span_id": root_eval_span_id,
                "span_attributes": {
                    "name": "test-consecutive-eval",
                    "type": "eval",
                },
            }
        ],
    )

    # Verify eval record 1 structure
    assert_matches_object(
        [eval_record_1],
        [
            {
                "root_span_id": root_eval_span_id,
                "span_parents": [root_eval_span_id],
                "span_attributes": {
                    "name": "eval",
                },
                "input": 1,
                "output": "Result for 1",
            }
        ],
    )

    # Verify eval record 2 structure
    assert_matches_object(
        [eval_record_2],
        [
            {
                "root_span_id": root_eval_span_id,
                "span_parents": [root_eval_span_id],
                "span_attributes": {
                    "name": "eval",
                },
                "input": 2,
                "output": "Result for 2",
            }
        ],
    )

    # Verify task 1 is child of eval record 1
    assert_matches_object(
        [task_1_span],
        [
            {
                "root_span_id": root_eval_span_id,
                "span_parents": [eval_record_1["span_id"]],
                "span_attributes": {
                    "name": "task",
                },
                "input": 1,
                "output": "Result for 1",
            }
        ],
    )

    # Verify task 2 is child of eval record 2
    assert_matches_object(
        [task_2_span],
        [
            {
                "root_span_id": root_eval_span_id,
                "span_parents": [eval_record_2["span_id"]],
                "span_attributes": {
                    "name": "task",
                },
                "input": 2,
                "output": "Result for 2",
            }
        ],
    )

    # Note: In this simplified test, we manually trigger LangChain callbacks but they don't
    # create actual RunnableSequence spans in the logger. The key verification is that Eval()
    # creates the proper hierarchy: root eval -> eval records -> tasks, and that consecutive
    # calls work correctly with proper parent-child relationships.
    # Real LangChain span integration is tested in other tests (test_llm_calls, etc.)


@pytest.mark.vcr
def test_streaming_ttft(logger_memory_logger: LoggerMemoryLogger):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)
    prompt = ChatPromptTemplate.from_template("Count from 1 to 5.")
    model = ChatOpenAI(
        model="gpt-4o-mini",
        max_completion_tokens=50,
        streaming=True,
    )
    chain: RunnableSerializable[Dict[str, str], BaseMessage] = prompt.pipe(model)

    # Collect chunks to verify streaming works
    chunks: List[str] = []
    for chunk in chain.stream({}, config={"callbacks": [cast(BaseCallbackHandler, handler)]}):
        if chunk.content:
            chunks.append(str(chunk.content))

    # Verify we got streaming chunks
    assert len(chunks) > 0, "Expected to receive streaming chunks"

    spans = memory_logger.pop()
    assert len(spans) == 3

    # Find the LLM span
    llm_spans = find_spans_by_attributes(spans, name="ChatOpenAI", type="llm")
    assert len(llm_spans) == 1
    llm_span = llm_spans[0]

    # Verify the span structure matches expectations
    assert_matches_object(
        [llm_span],
        [
            {
                "id": ANY,
                "input": [
                    [
                        {
                            "additional_kwargs": {},
                            "content": "Count from 1 to 5.",
                            "example": False,
                            "id": None,
                            "name": None,
                            "response_metadata": {},
                            "type": "human",
                        }
                    ]
                ],
                "metadata": {
                    "braintrust": {
                        "integration_name": "langchain-py",
                    }
                },
                "metrics": {
                    "time_to_first_token": ANY,
                },
                "output": {
                    "generations": [
                        [
                            {
                                "generation_info": {
                                    "finish_reason": "stop",
                                    "model_name": ANY,
                                },
                                "message": {
                                    "content": "1, 2, 3, 4, 5.",
                                    "type": "AIMessageChunk",
                                },
                                "text": "1, 2, 3, 4, 5.",
                                "type": "ChatGenerationChunk",
                            }
                        ]
                    ],
                    "type": "LLMResult",
                },
                "project_id": "langchain-py",
                "span_attributes": {"name": "ChatOpenAI", "type": "llm"},
            }
        ],
    )


@pytest.mark.vcr
def test_prompt_caching_tokens(logger_memory_logger: LoggerMemoryLogger):
    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)

    model = ChatAnthropic(model="claude-sonnet-4-5-20250929")

    # XXX: if you need to change the cassette or test, you'll want to change the text below to invalidate the stored cache.

    # Anthropic prompt caching requires a minimum of 1024 tokens for Claude Sonnet models.
    # This static text (~1500 tokens) ensures we meet that threshold consistently.
    # See: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
    long_text_for_caching = """
# Comprehensive Guide to Software Testing Methods!

## Chapter 1: Introduction to Testing

Software testing is a critical component of the software development lifecycle. It ensures that applications
function correctly, meet requirements, and provide a positive user experience. This guide covers various
testing methodologies, best practices, and tools used in modern software development.

### 1.1 The Importance of Testing

Testing helps identify defects early in the development process, reducing the cost of fixing issues later.
Studies have shown that the cost of fixing a bug increases exponentially as it progresses through the
development lifecycle. A bug found during requirements gathering might cost $1 to fix, while the same bug
found in production could cost $100 or more.

### 1.2 Types of Testing

There are many types of testing, including:
- Unit Testing: Testing individual components or functions in isolation
- Integration Testing: Testing how components work together
- End-to-End Testing: Testing the entire application flow
- Performance Testing: Testing application speed and scalability
- Security Testing: Testing for vulnerabilities and security issues
- Usability Testing: Testing user experience and interface design

## Chapter 2: Unit Testing Best Practices

Unit testing focuses on testing the smallest testable parts of an application. Here are some best practices:

### 2.1 Write Tests First (TDD)

Test-Driven Development (TDD) is a methodology where tests are written before the actual code. The process
follows a simple cycle: Red (write a failing test), Green (write code to pass the test), Refactor (improve
the code while keeping tests passing).

### 2.2 Keep Tests Independent

Each test should be independent of others. Tests should not rely on the state created by previous tests.
This ensures that tests can be run in any order and that failures are isolated and easy to debug.

### 2.3 Use Meaningful Names

Test names should clearly describe what is being tested and what the expected outcome is. A good test name
might be "test_user_registration_with_valid_email_succeeds" rather than just "test_registration".

### 2.4 Test Edge Cases

Don't just test the happy path. Consider edge cases like:
- Empty inputs
- Null or undefined values
- Very large inputs
- Invalid formats
- Boundary conditions

## Chapter 3: Integration Testing

Integration testing verifies that different modules or services work together correctly.

### 3.1 Database Integration

When testing database interactions, consider using:
- Test databases separate from production
- Database transactions that roll back after each test
- Mock data that represents realistic scenarios

### 3.2 API Integration

API integration tests should verify:
- Correct HTTP status codes
- Response format and schema
- Error handling
- Authentication and authorization

## Chapter 4: Performance Testing

Performance testing ensures your application can handle expected load and scale appropriately.

### 4.1 Load Testing

Load testing simulates multiple users accessing the application simultaneously. Key metrics include:
- Response time under load
- Throughput (requests per second)
- Error rates
- Resource utilization (CPU, memory, network)

### 4.2 Stress Testing

Stress testing pushes the application beyond normal operational capacity to find breaking points and
understand how the system fails gracefully.

## Chapter 5: Continuous Integration and Testing

Modern development practices integrate testing into the CI/CD pipeline.

### 5.1 Automated Test Runs

Tests should run automatically on every code change. This includes:
- Running unit tests on every commit
- Running integration tests on pull requests
- Running end-to-end tests before deployment

### 5.2 Test Coverage

Test coverage metrics help identify untested code. While 100% coverage isn't always practical or necessary,
maintaining good coverage helps ensure code quality. Focus on critical paths and business logic.

## Chapter 6: Testing Tools and Frameworks

Many tools exist to support testing efforts:

### 6.1 Python Testing
- pytest: Feature-rich testing framework
- unittest: Built-in Python testing module
- mock: Library for mocking objects

### 6.2 JavaScript Testing
- Jest: Popular testing framework
- Mocha: Flexible testing framework
- Cypress: End-to-end testing tool

### 6.3 Other Tools
- Selenium: Browser automation
- JMeter: Performance testing
- Postman: API testing

## Conclusion

Effective testing is essential for delivering high-quality software. By following best practices and using
appropriate tools, teams can catch bugs early, improve code quality, and deliver better products to users.

Remember: Testing is not just about finding bugs, it's about building confidence in your code.
"""

    messages: list[BaseMessage] = [
        SystemMessage(
            content=[
                {
                    "type": "text",
                    "text": long_text_for_caching,
                    "cache_control": {"type": "ephemeral"},
                }
            ]
        ),
        HumanMessage(content="What is the first type of testing mentioned in section 1.2?"),
    ]

    res = model.invoke(messages, config={"callbacks": [cast(BaseCallbackHandler, handler)]})

    spans = memory_logger.pop()
    assert len(spans) > 0

    llm_spans = find_spans_by_attributes(spans, name="ChatAnthropic", type="llm")
    assert len(llm_spans) == 1
    first_span = llm_spans[0]

    assert "metrics" in first_span
    first_metrics = first_span["metrics"]
    assert "prompt_tokens" in first_metrics
    assert first_metrics["prompt_tokens"] > 0

    assert "prompt_cache_creation_tokens" in first_metrics
    assert first_metrics["prompt_cache_creation_tokens"] > 0
    assert first_metrics["prompt_cached_tokens"] == 0

    res = model.invoke(
        messages + [res, HumanMessage(content="What testing framework is mentioned for Python?")],
        config={"callbacks": [cast(BaseCallbackHandler, handler)]},
    )

    spans = memory_logger.pop()
    assert len(spans) > 0

    llm_spans = find_spans_by_attributes(spans, name="ChatAnthropic", type="llm")

    print(llm_spans)

    assert len(llm_spans) == 1
    second_span = llm_spans[0]

    assert "metrics" in second_span
    second_metrics = second_span["metrics"]

    assert "prompt_cached_tokens" in second_metrics
    assert second_metrics["prompt_cached_tokens"] > 0

    assert "prompt_tokens" in second_metrics
    assert second_metrics["prompt_tokens"] > 0
