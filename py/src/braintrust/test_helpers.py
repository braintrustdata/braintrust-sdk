import pytest

from braintrust import logger
from braintrust.logger import ObjectMetadata, OrgProjectMetadata, _MemoryBackgroundLogger
from braintrust.util import LazyValue

# Fake API key for testing only - this will not work with actual API calls
TEST_ORG_ID = "test-org-id"
TEST_ORG_NAME = "test-org-name"


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
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


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
    return l


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
