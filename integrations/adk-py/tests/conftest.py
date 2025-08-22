import pytest
from braintrust import init_logger, os  # type:ignore

from tests.helpers import force_tracer_provider


@pytest.fixture(autouse=True, scope="function")
def setup():
    os.environ.setdefault("BRAINTRUST_API_KEY", "test")
    os.environ["BRAINTRUST_APP_URL"] = "https://www.braintrust.dev/"
    os.environ["BRAINTRUST_API_URL"] = "https://api.braintrust.dev/"
    os.environ.setdefault("GOOGLE_API_KEY", "test")
    force_tracer_provider()
    init_logger(project="braintrust-adk")
    yield


@pytest.fixture(scope="module")
def vcr_config():
    return {
        "filter_headers": [
            ("authorization", "REDACTED"),
            ("x-api-key", "REDACTED"),
            ("x-goog-api-key", "REDACTED"),
        ]
    }
