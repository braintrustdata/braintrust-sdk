# pyright: reportPrivateUsage=none
import os

import pytest
from braintrust import Tuple
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
    if (os.environ.get("UPDATE") or "") == "":
        os.environ["BRAINTRUST_API_KEY"] = TEST_API_KEY
        os.environ["ANTHROPIC_API_KEY"] = "your_anthropic_api_key_here"
        os.environ["OPENAI_API_KEY"] = "your_openai_api_key_here"

    _internal_reset_global_state()
    clear_global_handler()
    yield


def before_record_response(response):
    """Remove Transfer-Encoding header and add Content-Length to prevent httpx streaming issues.

    When VCR replays responses with Transfer-Encoding: chunked, httpx treats
    them as streaming responses, causing ResponseNotRead errors. We remove
    this header and add Content-Length since we're storing the full response body.
    """
    if "headers" in response:
        # Remove Transfer-Encoding header (case-insensitive)
        headers_to_remove = [k for k in response["headers"].keys() if k.lower() == "transfer-encoding"]
        for header in headers_to_remove:
            del response["headers"][header]

        # Add Content-Length header if not present and we have a body
        if "body" in response and response["body"]:
            has_content_length = any(k.lower() == "content-length" for k in response["headers"].keys())
            if not has_content_length:
                body = response["body"]
                if isinstance(body, dict) and "string" in body:
                    body_content = body["string"]
                elif isinstance(body, str):
                    body_content = body
                else:
                    body_content = str(body)

                if isinstance(body_content, bytes):
                    content_length = len(body_content)
                else:
                    content_length = len(body_content.encode("utf-8"))
                response["headers"]["Content-Length"] = str(content_length)

    return response


@pytest.fixture(scope="module")
def vcr_config():
    # In CI, use "none" to never make real requests
    # Locally, use "once" to record new cassettes if they don't exist
    record_mode = "all" if os.environ.get("UPDATE") else "none"

    return {
        "filter_headers": [
            "authorization",
            "x-goog-api-key",
            "x-api-key",
            "api-key",
            "openai-api-key",
        ],
        "record_mode": record_mode,
        "match_on": ["uri", "method"],
        "cassette_library_dir": "src/tests/cassettes",
        "path_transformer": lambda path: path.replace(".yaml", ""),
        "decode_compressed_response": True,
        "before_record_response": before_record_response,
    }


@pytest.fixture
def logger_memory_logger():
    logger = init_test_logger("langchain-py")
    with _internal_with_memory_background_logger() as bgl:
        yield (logger, bgl)


LoggerMemoryLogger = Tuple[Logger, _MemoryBackgroundLogger]
