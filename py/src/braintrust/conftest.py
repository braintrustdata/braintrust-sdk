import os

import pytest


@pytest.fixture(autouse=True)
def override_app_url_for_tests():
    """
    Temporarily override BRAINTRUST_APP_URL to production URL for consistent test behavior.

    This fixture ensures that tests always use the production URL (https://www.braintrust.dev)
    regardless of the local development environment settings. This prevents test failures
    when BRAINTRUST_APP_URL is set to localhost for development.
    """
    original_app_url = os.environ.get("BRAINTRUST_APP_URL")
    original_app_public_url = os.environ.get("BRAINTRUST_APP_PUBLIC_URL")

    # Set to production URL for consistent test behavior
    os.environ["BRAINTRUST_APP_URL"] = "https://www.braintrust.dev"
    if "BRAINTRUST_APP_PUBLIC_URL" in os.environ:
        del os.environ["BRAINTRUST_APP_PUBLIC_URL"]

    try:
        yield
    finally:
        # Restore original environment variables
        if original_app_url is not None:
            os.environ["BRAINTRUST_APP_URL"] = original_app_url
        elif "BRAINTRUST_APP_URL" in os.environ:
            del os.environ["BRAINTRUST_APP_URL"]

        if original_app_public_url is not None:
            os.environ["BRAINTRUST_APP_PUBLIC_URL"] = original_app_public_url


@pytest.fixture(autouse=True)
def setup_braintrust():
    os.environ.setdefault("GOOGLE_API_KEY", os.getenv("GEMINI_API_KEY", "your_google_api_key_here"))
