import json
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple, TypedDict, Union, cast

import httpx
import pytest
import responses
import respx
from braintrust import init_logger
from braintrust.logger import flush
from braintrust.wrappers.langchain import BraintrustTracer
from langchain.prompts import ChatPromptTemplate
from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableSerializable
from langchain_openai import ChatOpenAI
from requests import PreparedRequest
from traitlets import Any

from .test_langchain_fixtures import CHAT_MATH


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
    input: Dict[str, Any]
    output: Any
    span_parents: Optional[List[str]]
    metadata: SpanMetadata


class LogRequest(TypedDict):
    rows: List[Span]


@pytest.fixture(autouse=True)
def setup():
    init_logger(project="langchain")
    yield


@pytest.fixture
def logs() -> List[LogRequest]:
    return []


@pytest.fixture
def mock_api(logs: List[LogRequest]):
    # Set up responses for Braintrust endpoints
    responses.add(
        responses.POST,
        "https://www.braintrust.dev/api/apikey/login",
        json={
            "org_info": [
                {
                    "id": "5d7c97d7-fef1-4cb7-bda6-7e3756a0ca8e",
                    "name": "braintrustdata.com",
                    "api_url": "https://test.braintrust.dev",
                    "git_metadata": {
                        "fields": [
                            "commit",
                            "branch",
                            "tag",
                            "author_name",
                            "author_email",
                            "commit_message",
                            "commit_time",
                            "dirty",
                        ],
                        "collect": "some",
                    },
                    "is_universal_api": True,
                    "proxy_url": "https://test.braintrust.dev",
                    "realtime_url": "wss://realtime.braintrustapi.com",
                }
            ]
        },
        status=200,
    )

    responses.add(
        responses.POST,
        "https://www.braintrust.dev/api/project/register",
        json={
            "project": {
                "id": "3ffc90fe-f806-4e53-8455-41f3f84a1e0c",
                "org_id": "5d7c97d7-fef1-4cb7-bda6-7e3756a0ca8e",
                "name": "langchain",
                "created": "2025-03-06T21:49:31.547Z",
                "deleted_at": None,
                "user_id": "526d851f-97bd-4215-b534-1f4bd62b307c",
                "settings": None,
            }
        },
        status=200,
    )

    def track_log_callback(request: PreparedRequest) -> Union[Exception, Tuple[int, Mapping[str, str], str]]:
        logs.append(json.loads(request.body or ""))
        return (
            200,
            {},
            json.dumps(
                {
                    "ids": ["8cb40987-0c16-4e6e-8d90-c3ee6836b37f", "23a20c74-99d2-4eba-9f1e-a47e5447f719"],
                    "xact_id": "1000194711624809737",
                }
            ),
        )

    responses.add_callback(
        responses.POST,
        "https://test.braintrust.dev/logs3",
        callback=track_log_callback,
    )

    # Set up respx for OpenAI endpoint
    with respx.mock(assert_all_mocked=True) as respx_mock:

        def success_response(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=CHAT_MATH)

        # Mock OpenAI API
        respx_mock.post("https://api.openai.com/v1/chat/completions").mock(side_effect=success_response)
        yield respx_mock


class LogsToSpansResult(TypedDict):
    spans: List[Span]
    root_span_id: Optional[str]
    root_run_id: Optional[str]


def logs_to_spans(logs: List[LogRequest]) -> LogsToSpansResult:
    """Convert logs to spans format, merging duplicate span IDs."""
    if not logs:
        raise ValueError("No logs to convert to spans")

    # Logs include partial updates (merges) for previous rows
    # We need to dedupe these and merge them to see the final state
    seen_ids: Set[str] = set()
    spans: List[Span] = []

    for log in logs:
        for row in log["rows"]:
            if row["span_id"] not in seen_ids:
                seen_ids.add(row["span_id"])
                spans.append(row)
            else:
                # Find and merge with existing span
                existing_span = next(span for span in spans if span["span_id"] == row["span_id"])
                # Merge dictionaries recursively
                for key, value in row.items():
                    if isinstance(value, dict) and key in existing_span:
                        existing_span[key] = {**existing_span[key], **value}
                    else:
                        existing_span[key] = value

    return {
        "spans": spans,
        "root_span_id": spans[0]["span_id"] if spans else None,
        "root_run_id": spans[0].get("metadata", {}).get("runId") if spans else None,
    }


@pytest.mark.focus
@responses.activate
def test_llm_calls(mock_api: respx.MockRouter, logs: List[LogRequest]):
    handler = BraintrustTracer()

    prompt = ChatPromptTemplate.from_template("What is 1 + {number}?")

    # in python these are not defaulted
    model = ChatOpenAI(model="gpt-4o-mini", temperature=1, top_p=1, frequency_penalty=0, presence_penalty=0, n=1)

    chain: RunnableSerializable[Dict[str, str], BaseMessage] = prompt | model
    # TODO: fix type?
    chain.invoke({"number": "2"}, config={"callbacks": [cast(BaseCallbackHandler, handler)]})

    flush()

    # Extract spans from logs using the new function
    result = logs_to_spans(logs)
    spans = result["spans"]
    root_span_id = result["root_span_id"]

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


RecursiveValue = Union[str, int, float, bool, None, Sequence["RecursiveValue"], Dict[str, "RecursiveValue"], Span]


def assert_matches_object(
    actual: RecursiveValue,
    expected: RecursiveValue,
) -> None:
    """Assert that actual contains all key-value pairs from expected.

    For lists, each item in expected must match the corresponding item in actual.
    For dicts, all key-value pairs in expected must exist in actual.
    """
    if isinstance(expected, (list, tuple)):
        assert isinstance(actual, (list, tuple)), f"Expected sequence but got {type(actual)}"
        assert len(actual) >= len(
            expected
        ), f"Expected sequence of length >= {len(expected)} but got length {len(actual)}"
        for i, expected_item in enumerate(expected):
            assert_matches_object(actual[i], expected_item)
    elif isinstance(expected, dict):
        assert isinstance(actual, dict), f"Expected dict but got {type(actual)}"
        for k, v in expected.items():
            assert k in actual, f"Missing key {k}"
            if isinstance(v, (dict, list, tuple)):
                assert_matches_object(cast(RecursiveValue, actual[k]), cast(RecursiveValue, v))
            else:
                assert actual[k] == v, f"Key {k}: expected {v} but got {actual[k]}"
    else:
        assert actual == expected, f"Expected {expected} but got {actual}"
