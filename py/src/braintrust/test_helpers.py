import os
from contextlib import contextmanager

import pytest
from braintrust import logger
from braintrust.logger import ObjectMetadata, OrgProjectMetadata, ProjectExperimentMetadata
from braintrust.util import LazyValue

# Fake API key for testing only - this will not work with actual API calls
TEST_ORG_ID = "test-org-id"
TEST_ORG_NAME = "test-org-name"


def has_devserver_installed() -> bool:
    """Check if devserver dependencies (starlette, uvicorn) are installed."""
    import importlib.util

    return importlib.util.find_spec("starlette") is not None and importlib.util.find_spec("uvicorn") is not None


def simulate_login() -> None:
    """
    Simulate a successful login for testing purposes.

    This lets you use Braintrust features that require login without actually
    connecting to the Braintrust service. Logs will be stored locally
    rather than sent to Braintrust.
    """
    simulate_logout()
    logger.login(api_key=logger.TEST_API_KEY)


def simulate_logout() -> None:
    """
    Simulate logging out for testing purposes.

    This resets the login state after using simulate_login_for_tests.
    """
    # Reset login state
    logger._state.reset_login_info()
    logger._state.reset_parent_state()


def assert_logged_out():
    assert not logger._state.logged_in
    assert logger._state.login_token is None
    assert logger._state.org_id is None
    assert logger._state.org_name is None


@pytest.fixture
def with_simulate_login():
    simulate_login()
    try:
        yield
    finally:
        simulate_logout()


@pytest.fixture
def with_memory_logger():
    logger._state.reset_parent_state()
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl
    # Clean up global state to prevent test contamination
    logger._state.reset_parent_state()


@pytest.fixture
def memory_logger():
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl
    logger._state.current_experiment = None


@contextmanager
def preserve_env_vars(*vars):
    original_env = {v: os.environ.get(v) for v in vars}
    try:
        yield
    finally:
        for v in vars:
            os.environ.pop(v, None)
        for v, val in original_env.items():
            if val:
                os.environ[v] = val


def init_test_logger(project_name: str):
    """
    Initialize a logger for testing with a fake project and org.

    This sets up a logger with fake metadata to avoid requiring actual
    API calls. This is useful for testing wrappers.

    Args:
        project_name: The name to use for the test project.
    """
    project_metadata = ObjectMetadata(id=project_name, name=project_name, full_info=dict())
    metadata = OrgProjectMetadata(org_id=TEST_ORG_ID, project=project_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)
    l = logger.init_logger(project=project_name)
    l._lazy_metadata = lazy_metadata  # Skip actual login by setting fake metadata directly

    # Replace the global _compute_logger_metadata function with a resolved LazyValue
    def fake_compute_logger_metadata(project_name=None, project_id=None):
        if project_id:
            project_metadata = ObjectMetadata(id=project_id, name=project_name, full_info=dict())
        else:
            project_metadata = ObjectMetadata(id=project_name, name=project_name, full_info=dict())
        return OrgProjectMetadata(org_id=TEST_ORG_ID, project=project_metadata)

    logger._compute_logger_metadata = fake_compute_logger_metadata
    return l


def init_test_exp(experiment_name: str, project_name: str = None):
    """
    Initialize an experiment for testing with fake project and experiment metadata.

    This sets up an experiment with fake metadata to avoid requiring actual
    API calls. This is useful for testing experiment validation behavior.

    Args:
        experiment_name: The name to use for the test experiment.
        project_name: The name to use for the test project. Defaults to experiment_name.
    """
    if project_name is None:
        project_name = experiment_name

    import braintrust

    project_metadata = ObjectMetadata(id=project_name, name=project_name, full_info=dict())
    experiment_metadata = ObjectMetadata(id=experiment_name, name=experiment_name, full_info=dict())
    metadata = ProjectExperimentMetadata(project=project_metadata, experiment=experiment_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)

    exp = braintrust.init(project=project_name, experiment=experiment_name)
    exp._lazy_metadata = lazy_metadata  # Skip actual login by setting fake metadata directly
    return exp


# ----------------------------------------------------------------------
# Tests for the helper functions
# ----------------------------------------------------------------------


def test_without_login_pre():
    assert not logger._state.logged_in


def test_with_simulate_login(with_simulate_login):
    assert logger._state.logged_in


def test_without_login_post():
    assert not logger._state.logged_in


def test_simulate_login_logout():
    """Test that simulate_login and simulate_logout work properly."""
    # Test that we're not logged in initially
    for i in range(4):
        assert not logger._state.logged_in

        # Simulate login
        simulate_login()

        # Verify we're now logged in with the expected test values
        assert logger._state.logged_in
        assert logger._state.login_token == logger.TEST_API_KEY
        assert logger._state.org_id == TEST_ORG_ID
        assert logger._state.org_name == TEST_ORG_NAME
        assert logger._state.app_url == "https://www.braintrust.dev"
        assert logger._state.app_public_url == "https://www.braintrust.dev"

        assert logger.org_id() == TEST_ORG_ID

        # Simulate logout
        simulate_logout()

        # Verify we're logged out
        assert not logger._state.logged_in
        assert logger._state.login_token is None
        assert logger._state.org_id is None
        assert logger._state.org_name is None


def test_memory_logger():
    init_test_logger(__name__)
    with logger._internal_with_memory_background_logger() as bgl:
        assert not bgl.pop()

        @logger.traced
        def thing():
            return "hello"

        thing()
        logs = bgl.pop()
        assert len(logs) == 1
        assert logs


def assert_dict_matches(actual, expected, exact_keys=False):
    """Assert that actual dictionary matches expected dictionary.

        The expected dictionary can be a subset of actual (i.e. actual can have additional keys).
        Values in expected can be functions that validate the actual value.

    Args:
        actual: The actual dictionary to check
        expected: The expected dictionary pattern to match
        exact_keys: If True, actual and expected must have exactly the same keys.
                   If False (default), actual can have keys not in expected.

    +    assert_dict_matches({"a":"a", "b":2, "c":3}, {
    +        "a": "a",  # Values match exactly
    +        "b": lambda x: isinstance(x, int)  # Custom validation with lambda
    +    })  # => passes
    """
    if exact_keys:
        actual_keys = set(actual.keys())
        expected_keys = set(expected.keys())
        assert actual_keys == expected_keys, f"Key sets do not match. Actual: {actual_keys}, Expected: {expected_keys}"

    for key, expected_val in expected.items():
        assert key in actual, f"Expected key '{key}' not found"

        actual_val = actual[key]

        if callable(expected_val):
            # Expected value is a validation function
            assert expected_val(actual_val), f"Validation failed for key '{key}': {actual_val}"
        elif isinstance(expected_val, dict) and isinstance(actual_val, dict):
            # Recursively validate nested dictionaries
            assert_dict_matches(actual_val, expected_val, exact_keys)
        elif isinstance(expected_val, (list, tuple)) and isinstance(actual_val, (list, tuple)):
            # Handle lists and tuples - must match exactly
            _assert_sequence_matches(actual_val, expected_val, key, exact_keys)
        else:
            # Direct value comparison
            assert actual_val == expected_val, (
                f"Value mismatch for key '{key}': expected {expected_val}, got {actual_val}"
            )


def _assert_sequence_matches(actual_seq, expected_seq, key, exact_keys=False):
    """Helper function to match sequences (lists/tuples) exactly."""
    assert len(expected_seq) == len(actual_seq), (
        f"Sequence length mismatch for key '{key}': expected {len(expected_seq)} items, got {len(actual_seq)}"
    )

    for i, (expected_item, actual_item) in enumerate(zip(expected_seq, actual_seq)):
        if isinstance(expected_item, dict) and isinstance(actual_item, dict):
            # Recursively validate nested dictionaries
            assert_dict_matches(actual_item, expected_item, exact_keys)
        elif isinstance(expected_item, (list, tuple)) and isinstance(actual_item, (list, tuple)):
            # Recursively validate nested sequences
            _assert_sequence_matches(actual_item, expected_item, f"{key}[{i}]", exact_keys)
        else:
            # Direct value comparison
            assert actual_item == expected_item, (
                f"Sequence item mismatch for key '{key}' at index {i}: expected {expected_item}, got {actual_item}"
            )


def test_assert_dict_matches():
    d = {"a": 1, "b": 2, "c": 3}
    assert_dict_matches(d, d)
    assert_dict_matches(d, d.copy())
    assert_dict_matches(d, {"a": 1, "b": 2})
    assert_dict_matches(d, {"b": 2, "c": 3})
    assert_dict_matches(d, {"b": lambda x: x == 2, "c": 3})
    assert_dict_matches(d, {"b": lambda x: isinstance(x, int), "c": 3})

    e = {"1": 1, "2": d}
    assert_dict_matches(e, e)

    # Test mismatched values
    with pytest.raises(AssertionError):
        assert_dict_matches(d, {"a": 2})

    # Test missing required key
    with pytest.raises(AssertionError):
        assert_dict_matches(d, {"d": 4})

    # Test lambda validation failure
    with pytest.raises(AssertionError):
        assert_dict_matches(d, {"a": lambda x: x > 10})

    # Test nested dict mismatch
    with pytest.raises(AssertionError):
        assert_dict_matches(e, {"1": 1, "2": {"a": 999}})

    # Test type mismatch
    with pytest.raises(AssertionError):
        assert_dict_matches(d, {"a": "1"})

    # Test empty expected dict should pass (matches any actual dict)
    assert_dict_matches(d, {})


def test_assert_dict_matches_exact_keys():
    """Test exact key matching."""
    actual = {"a": 1, "b": 2, "c": 3}

    # Exact match should pass
    assert_dict_matches(actual, {"a": 1, "b": 2, "c": 3}, exact_keys=True)

    # Missing key in expected should fail
    with pytest.raises(AssertionError, match="Key sets do not match"):
        assert_dict_matches(actual, {"a": 1, "b": 2}, exact_keys=True)

    # Extra key in expected should fail
    with pytest.raises(AssertionError, match="Key sets do not match"):
        assert_dict_matches(actual, {"a": 1, "b": 2, "c": 3, "d": 4}, exact_keys=True)

    # Test with nested dictionaries
    actual_nested = {"outer": {"a": 1, "b": 2}}

    # Exact nested match should pass
    assert_dict_matches(actual_nested, {"outer": {"a": 1, "b": 2}}, exact_keys=True)

    # Missing nested key should fail
    with pytest.raises(AssertionError, match="Key sets do not match"):
        assert_dict_matches(actual_nested, {"outer": {"a": 1}}, exact_keys=True)


def test_assert_dict_matches_with_lists_and_tuples():
    """Test that assert_dict_matches correctly handles lists and tuples."""

    # Test with lists - exact match
    actual_with_list = {
        "messages": [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi there"}],
        "model": "gpt-4",
    }

    # Should match exact list
    assert_dict_matches(
        actual_with_list,
        {"messages": [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi there"}]},
    )

    # Test with tuples
    actual_with_tuple = {"coords": (1, 2, 3), "name": "point"}

    assert_dict_matches(actual_with_tuple, {"coords": (1, 2, 3)})

    # Test with mixed nested structures
    complex_actual = {"data": {"items": [{"id": 1, "tags": ("a", "b")}, {"id": 2, "tags": ("c", "d")}]}}

    assert_dict_matches(
        complex_actual, {"data": {"items": [{"id": 1, "tags": ("a", "b")}, {"id": 2, "tags": ("c", "d")}]}}
    )

    # Test partial dictionary match within list items
    assert_dict_matches(
        complex_actual,
        {
            "data": {
                "items": [{"id": 1}, {"tags": ("c", "d")}]  # Only checking id, not tags  # Only checking tags, not id
            }
        },
    )

    # Test list length mismatch
    with pytest.raises(AssertionError):
        assert_dict_matches(
            actual_with_list,
            {"messages": [{"role": "user", "content": "Hello"}]},  # Expected only 1 item, actual has 2
        )

    # Test list content mismatch
    with pytest.raises(AssertionError):
        assert_dict_matches(
            actual_with_list,
            {"messages": [{"role": "user", "content": "Wrong content"}, {"role": "assistant", "content": "Hi there"}]},
        )

    # Test tuple mismatch
    with pytest.raises(AssertionError):
        assert_dict_matches(actual_with_tuple, {"coords": (1, 2, 4)})  # Wrong third element
