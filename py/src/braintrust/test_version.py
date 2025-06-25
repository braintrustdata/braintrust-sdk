import os

from braintrust import version


def test_version():
    """Test the version module and verify templating works correctly."""
    # Detect wheel testing environment in multiple ways for robustness.
    # The env variable makes sure we're not running from source
    wheel_env = os.environ.get("BRAINTRUST_TESTING_WHEEL") == "1"
    is_wheel_in_path = "site-packages" in version.__file__
    is_from_wheel = wheel_env or is_wheel_in_path

    # Basic assertions that should always pass
    assert version.VERSION
    assert version.GIT_COMMIT
    assert isinstance(version.VERSION, str)
    assert isinstance(version.GIT_COMMIT, str)
    assert len(version.VERSION) > 0
    assert len(version.GIT_COMMIT) > 0
    if is_from_wheel:
        # When testing from the wheel, GIT_COMMIT
        # should be the actual commit hash, not the placeholder
        assert version.GIT_COMMIT != "__GIT_COMMIT__"
    else:
        # When testing from source directly, we expect to see the placeholder
        assert version.GIT_COMMIT == "__GIT_COMMIT__"
