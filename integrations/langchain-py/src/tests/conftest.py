# pyright: reportPrivateUsage=none
import os

import pytest
from braintrust.logger import (
    TEST_API_KEY,
    Logger,
    _internal_reset_global_state,
    _internal_with_memory_background_logger,
    _MemoryBackgroundLogger,
)
from braintrust.test_helpers import init_test_logger

from braintrust_langchain.context import clear_global_handler


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
    # In CI, use "none" to never make real requests
    # Locally, use "once" to record new cassettes if they don't exist
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
        "cassette_library_dir": "src/tests/cassettes",
        "path_transformer": lambda path: path.replace(".yaml", ""),
    }


@pytest.fixture
def logger_memory_logger():
    logger = init_test_logger("langchain-py")
    with _internal_with_memory_background_logger() as bgl:
        yield (logger, bgl)


LoggerMemoryLogger = tuple[Logger, _MemoryBackgroundLogger]
