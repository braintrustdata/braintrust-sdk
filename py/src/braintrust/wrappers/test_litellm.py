import asyncio
import time
from typing import Any, Dict, Optional

import litellm
import pytest

from braintrust import logger
from braintrust.span_types import SpanTypeAttribute
from braintrust.test_helpers import assert_dict_matches, init_test_logger
from braintrust.wrappers.litellm import wrap_litellm
from braintrust.wrappers.test_utils import assert_metrics_are_valid

TEST_ORG_ID = "test-org-openai-py-tracing"
PROJECT_NAME = "test-project-litellm-py-tracing"
TEST_MODEL = "gpt-4o-mini"  # cheapest model for tests
TEST_PROMPT = "What's 12 + 12?"
TEST_SYSTEM_PROMPT = "You are a helpful assistant that only responds with numbers."


@pytest.fixture(scope="module")
def vcr_config():
    return {
        "filter_headers": [
            "authorization",
            "openai-organization",
        ]
    }


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


@pytest.mark.vcr
def test_litellm_chat_metrics(memory_logger):
    assert not memory_logger.pop()

    wrapped_litellm = wrap_litellm(litellm)

    start = time.time()
    response = wrapped_litellm.completion(model=TEST_MODEL, messages=[{"role": "user", "content": TEST_PROMPT}])
    end = time.time()

    assert response
    assert response.choices[0].message.content
    assert "24" in response.choices[0].message.content or "twenty-four" in response.choices[0].message.content.lower()

    # Verify spans were created with wrapped client

    spans = memory_logger.pop()
    print(spans)
    assert len(spans) == 1
    span = spans[0]
    assert span
    # Verify metrics
    metrics = span["metrics"]
    assert_metrics_are_valid(metrics, start, end)
    # Verify metadata and input
    assert span["metadata"]["model"] == TEST_MODEL
    assert span["metadata"]["provider"] == "litellm"
    assert TEST_PROMPT in str(span["input"])
