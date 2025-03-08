from typing import Any, Dict, Sequence, Union, cast

from braintrust.logger import Span

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
