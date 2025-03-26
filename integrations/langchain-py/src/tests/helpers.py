from contextlib import contextmanager
from typing import Any, Dict, Generator, List, Optional, Sequence, Set, Tuple, Union, cast

import httpx
import respx
from braintrust.logger import Span, flush

from .types import LogRequest, Span

# Base types that can appear in values
PrimitiveValue = Union[str, int, float, bool, None, Span]
RecursiveValue = Union[PrimitiveValue, Dict[str, Any], Sequence[Any]]


def assert_matches_object(
    actual: RecursiveValue,
    expected: RecursiveValue,
) -> None:
    """Assert that actual contains all key-value pairs from expected.

    For lists, each item in expected must match the corresponding item in actual.
    For dicts, all key-value pairs in expected must exist in actual.

    Args:
        actual: The actual value to check
        expected: The expected value to match against

    Raises:
        AssertionError: If the actual value doesn't match the expected value
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


@contextmanager
def mock_openai(responses: List[Dict[str, Any]]) -> Generator[respx.MockRouter, None, None]:
    """Context manager for mocking OpenAI API with custom responses."""
    with respx.mock(assert_all_mocked=True) as respx_mock:

        def success_response(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=responses.pop(0))

        respx_mock.post("https://api.openai.com/v1/chat/completions").mock(side_effect=success_response)

        yield respx_mock

        flush()


def logs_to_spans(logs: List[LogRequest]) -> Tuple[List[Span], Optional[str], Optional[str]]:
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

    return spans, spans[0]["span_id"] if spans else None, spans[0].get("metadata", {}).get("runId") if spans else None


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
