import time

import openai
import pytest

from braintrust import logger, wrap_openai
from braintrust.logger import ObjectMetadata, OrgProjectMetadata
from braintrust.util import LazyValue
from braintrust.wrappers.anthropic import wrap_anthropic

TEST_ORG_ID = "test-org-openai-py-tracing"
PROJECT_NAME = "test-project-openai-py-tracing"
TEST_MODEL = "gpt-4o-mini"  # cheapest model for tests


def _setup_test_logger():
    # FIXME[matt] make reusable
    project_metadata = ObjectMetadata(id=PROJECT_NAME, name=PROJECT_NAME, full_info=dict())
    metadata = OrgProjectMetadata(org_id=TEST_ORG_ID, project=project_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)
    l = logger.init_logger(project=PROJECT_NAME)
    l._lazy_metadata = lazy_metadata  # FIXME[matt] this is cheesy but it stops us from having to login


@pytest.fixture
def memory_logger():
    _setup_test_logger()
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


def test_openai_chat_metrics(memory_logger):
    assert not memory_logger.pop()

    client = wrap_openai(openai.OpenAI())

    start = time.time()
    response = client.chat.completions.create(
        model=TEST_MODEL, messages=[{"role": "user", "content": "What's 12 + 12?"}]
    )
    end = time.time()

    assert response
    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert 0 < metrics["time_to_first_token"]
    assert 0 < metrics["tokens"]
    assert 0 < metrics["prompt_tokens"]
    assert 0 < metrics["completion_tokens"]
    assert start < metrics["start"] < metrics["end"] < end


def test_openai_responses_metrics(memory_logger):
    assert not memory_logger.pop()

    client = wrap_openai(openai.OpenAI())

    start = time.time()
    response = client.responses.create(
        model=TEST_MODEL,
        input="What's 12 + 12?",
        instructions="Just the number please",
    )
    end = time.time()

    assert response

    spans = memory_logger.pop()
    assert len(spans) == 1
    span = spans[0]
    assert span
    metrics = span["metrics"]
    assert 0 < metrics["time_to_first_token"]
    assert 0 < metrics["tokens"]
    assert 0 < metrics["prompt_tokens"]
    assert 0 < metrics["completion_tokens"]
    assert 0 <= metrics["prompt_cached_tokens"]
    assert 0 <= metrics["completion_reasoning_tokens"]
    assert start < metrics["start"] < metrics["end"] < end
