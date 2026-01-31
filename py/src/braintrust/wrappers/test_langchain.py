# pyright: reportTypedDictNotRequiredAccess=none
"""
Tests for LangChain integration.

Migrated from integrations/langchain-py/src/tests/
"""

import os
import uuid
from typing import Any, Dict, List, Optional, Sequence, TypedDict, Union, cast
from unittest.mock import ANY

import pytest
from braintrust import flush
from braintrust.logger import (
    TEST_API_KEY,
    Logger,
    _internal_reset_global_state,
    _internal_with_memory_background_logger,
    _MemoryBackgroundLogger,
)
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.langchain import (
    BraintrustCallbackHandler,
    clear_global_handler,
    set_global_handler,
    setup_langchain,
)

# --- Type definitions (from types.py) ---


class SpanAttributes(TypedDict):
    name: str
    type: Optional[str]


class SpanMetadata(TypedDict, total=False):
    tags: List[str]
    model: str
    temperature: float
    top_p: float
    frequency_penalty: float
    presence_penalty: float
    n: int
    runId: Optional[str]


class SpanRequired(TypedDict):
    span_id: str


class Span(SpanRequired, total=False):
    span_attributes: SpanAttributes
    input: Any
    output: Any
    span_parents: Optional[List[str]]
    metadata: SpanMetadata
    root_span_id: str
    metrics: Dict[str, Any]


# --- Helper functions (from helpers.py) ---

PrimitiveValue = Union[str, int, float, bool, None, Span]
RecursiveValue = Union[PrimitiveValue, Dict[str, Any], Sequence[Any]]


def assert_matches_object(
    actual: RecursiveValue,
    expected: RecursiveValue,
    ignore_order: bool = False,
) -> None:
    """Assert that actual contains all key-value pairs from expected."""
    if isinstance(expected, (list, tuple)):
        assert isinstance(actual, (list, tuple)), f"Expected sequence but got {type(actual)}"
        assert len(actual) >= len(expected), (
            f"Expected sequence of length >= {len(expected)} but got length {len(actual)}"
        )
        if not ignore_order:
            for i, expected_item in enumerate(expected):
                assert_matches_object(actual[i], expected_item)
        else:
            for expected_item in expected:
                matched = False
                for actual_item in actual:
                    try:
                        assert_matches_object(actual_item, expected_item)
                        matched = True
                    except:
                        pass
                assert matched, f"Expected {expected_item} in unordered sequence but couldn't find match in {actual}"

    elif isinstance(expected, dict):
        assert isinstance(actual, dict), f"Expected dict but got {type(actual)}"
        for k, v in expected.items():
            assert k in actual, f"Missing key {k}"
            if v is ANY:
                continue
            if isinstance(v, (dict, list, tuple)):
                assert_matches_object(cast(RecursiveValue, actual[k]), cast(RecursiveValue, v))
            else:
                assert actual[k] == v, f"Key {k}: expected {v} but got {actual[k]}"
    else:
        assert actual == expected, f"Expected {expected} but got {actual}"


def find_spans_by_attributes(spans: List[Span], **attributes: Any) -> List[Span]:
    """Find all spans that match the given attributes."""
    matching_spans: List[Span] = []
    for span in spans:
        matches = True
        if "span_attributes" not in span:
            matches = False
            continue
        for key, value in attributes.items():
            if key not in span["span_attributes"] or span["span_attributes"][key] != value:
                matches = False
                break
        if matches:
            matching_spans.append(span)
    return matching_spans


# --- Fixtures ---

LoggerMemoryLogger = tuple[Logger, _MemoryBackgroundLogger]


@pytest.fixture(autouse=True)
def setup_braintrust():
    os.environ["BRAINTRUST_SYNC_FLUSH"] = "1"
    os.environ["BRAINTRUST_API_URL"] = "http://localhost:8000"
    os.environ["BRAINTRUST_APP_URL"] = "http://localhost:3000"
    os.environ["BRAINTRUST_API_KEY"] = TEST_API_KEY
    os.environ["ANTHROPIC_API_KEY"] = "your_anthropic_api_key_here"
    os.environ["OPENAI_API_KEY"] = "your_openai_api_key_here"
    os.environ["OPENAI_BASE_URL"] = "http://localhost:8000/v1/proxy"

    _internal_reset_global_state()
    clear_global_handler()
    yield


@pytest.fixture(scope="module")
def vcr_config():
    record_mode = "none" if (os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS")) else "once"

    return {
        "filter_headers": [
            "authorization",
            "x-goog-api-key",
            "x-api-key",
            "api-key",
            "openai-api-key",
        ],
        "record_mode": record_mode,
        "match_on": ["uri", "method", "body"],
        "cassette_library_dir": "src/braintrust/wrappers/cassettes/test_langchain",
        "path_transformer": lambda path: path.replace(".yaml", ""),
    }


@pytest.fixture
def logger_memory_logger():
    logger = init_test_logger("langchain-py")
    with _internal_with_memory_background_logger() as bgl:
        yield (logger, bgl)


# --- Tests ---


def test_setup_langchain():
    """Test that setup_langchain registers a global handler."""
    clear_global_handler()
    result = setup_langchain()
    assert result is True

    # Verify handler is registered
    from langchain_core.callbacks import CallbackManager
    manager = CallbackManager.configure()
    assert any(isinstance(h, BraintrustCallbackHandler) for h in manager.handlers)


@pytest.mark.vcr
def test_llm_calls(logger_memory_logger: LoggerMemoryLogger):
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.messages import BaseMessage
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.runnables import RunnableSerializable
    from langchain_openai import ChatOpenAI

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
                "metadata": {"tags": []},
                "span_id": root_span_id,
                "root_span_id": root_span_id,
            },
            {
                "span_attributes": {"name": "ChatPromptTemplate"},
                "input": {"number": "2"},
                "metadata": {"tags": ["seq:step:1"]},
                "root_span_id": root_span_id,
                "span_parents": [root_span_id],
            },
            {
                "span_attributes": {"name": "ChatOpenAI", "type": "llm"},
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
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.messages import BaseMessage
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.runnables import RunnableSerializable
    from langchain_openai import ChatOpenAI

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
                "metadata": {"tags": ["test"]},
                "span_id": root_span_id,
                "root_span_id": root_span_id,
            },
        ],
    )


@pytest.mark.vcr
def test_tool_usage(logger_memory_logger: LoggerMemoryLogger):
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.tools import tool
    from langchain_openai import ChatOpenAI
    from pydantic import BaseModel, Field

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
                "metadata": {
                    "tags": [],
                    "model": "gpt-4o-mini-2024-07-18",
                },
            }
        ],
    )


@pytest.mark.vcr
def test_langgraph_state_management(logger_memory_logger: LoggerMemoryLogger):
    from langchain_openai import ChatOpenAI

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

    langgraph_spans = find_spans_by_attributes(spans, name="LangGraph")
    say_hello_spans = find_spans_by_attributes(spans, name="sayHello")
    say_bye_spans = find_spans_by_attributes(spans, name="sayBye")
    llm_spans = find_spans_by_attributes(spans, name="ChatOpenAI")

    assert len(langgraph_spans) == 1
    assert len(say_hello_spans) == 1
    assert len(say_bye_spans) == 1
    assert len(llm_spans) == 1

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


@pytest.mark.vcr
def test_global_handler(logger_memory_logger: LoggerMemoryLogger):
    from langchain_core.callbacks import CallbackManager
    from langchain_core.messages import BaseMessage
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.runnables import RunnableSerializable
    from langchain_openai import ChatOpenAI

    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger, debug=True)
    set_global_handler(handler)

    manager = CallbackManager.configure()
    assert next((h for h in manager.handlers if isinstance(h, BraintrustCallbackHandler)), None) == handler

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

    message = chain.invoke({"number": "2"})

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
        ],
    )

    assert message.content == "1 + 2 equals 3."


@pytest.mark.vcr
def test_streaming_ttft(logger_memory_logger: LoggerMemoryLogger):
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.messages import BaseMessage
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.runnables import RunnableSerializable
    from langchain_openai import ChatOpenAI

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

    chunks: List[str] = []
    for chunk in chain.stream({}, config={"callbacks": [cast(BaseCallbackHandler, handler)]}):
        if chunk.content:
            chunks.append(str(chunk.content))

    assert len(chunks) > 0, "Expected to receive streaming chunks"

    spans = memory_logger.pop()
    assert len(spans) == 3

    llm_spans = find_spans_by_attributes(spans, name="ChatOpenAI", type="llm")
    assert len(llm_spans) == 1
    llm_span = llm_spans[0]

    assert "metrics" in llm_span
    assert "time_to_first_token" in llm_span["metrics"]


@pytest.mark.vcr
def test_langchain_anthropic_integration(logger_memory_logger: LoggerMemoryLogger):
    from langchain_anthropic import ChatAnthropic
    from langchain_core.prompts import ChatPromptTemplate

    MODEL = "claude-sonnet-4-20250514"

    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)
    set_global_handler(handler)

    prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")
    # max_tokens must match the recorded cassette (default changed from 1024 to 64000)
    model = ChatAnthropic(model_name=MODEL, max_tokens=1024)

    chain = prompt | model

    result = chain.invoke({"number": "2"})

    flush()

    assert isinstance(result.content, str)
    assert "3" in result.content.lower()

    spans = memory_logger.pop()
    assert len(spans) > 0

    llm_spans = [span for span in spans if span["span_attributes"].get("type") == "llm"]
    assert len(llm_spans) > 0, "Should have at least one LLM call"

    llm_span = llm_spans[0]
    assert llm_span["metadata"]["model"] == MODEL


@pytest.mark.vcr
@pytest.mark.asyncio
async def test_async_langchain_invoke(logger_memory_logger: LoggerMemoryLogger):
    from langchain_anthropic import ChatAnthropic
    from langchain_core.prompts import ChatPromptTemplate

    MODEL = "claude-sonnet-4-20250514"

    logger, memory_logger = logger_memory_logger
    assert not memory_logger.pop()

    handler = BraintrustCallbackHandler(logger=logger)
    set_global_handler(handler)

    prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")
    # max_tokens must match the recorded cassette (default changed from 1024 to 64000)
    model = ChatAnthropic(model_name=MODEL, max_tokens=1024)

    chain = prompt | model

    result = await chain.ainvoke({"number": "2"})

    flush()

    assert isinstance(result.content, str)
    assert "3" in result.content.lower()

    spans = memory_logger.pop()
    assert len(spans) > 0


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
