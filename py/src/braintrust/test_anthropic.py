"""
Tests to ensure we reliably wrpa the Anthropic API.
"""


import os
import time

import anthropic

from braintrust import logger
from braintrust.logger import ObjectMetadata, OrgProjectMetadata
from braintrust.util import LazyValue
from braintrust.wrappers.anthropic import wrap_anthropic_client

TEST_ORG_ID = "test-org-123"


def _setup_test_logger(project_name: str):
    # FIXME[matt] make reusable
    project_metadata = ObjectMetadata(id=project_name, name=project_name, full_info=dict())
    metadata = OrgProjectMetadata(org_id=TEST_ORG_ID, project=project_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)
    l = logger.init_logger(project=project_name)
    l._lazy_metadata = lazy_metadata  # FIXME[matt] this is cheesy but it stops us from having to login


def _get_anthropic_client():
    return anthropic.Anthropic()


def test_memory_logger():
    # FIXME[matt] this should be moved to a common place
    _setup_test_logger("test-anthropic-app")
    with logger._internal_with_memory_background_logger() as bgl:
        assert not bgl.pop()

        @logger.traced
        def thing():
            return "hello"

        thing()

        logs = bgl.pop()
        assert len(logs) == 1
        assert logs


def test_anthropic_client_error():
    project_name = "test-anthropic-err"
    _setup_test_logger(project_name)

    with logger._internal_with_memory_background_logger() as bgl:
        assert not bgl.pop()

        client = wrap_anthropic_client(_get_anthropic_client())

        model = "there-is-no-such-model"
        msg_in = {"role": "user", "content": "who are you?"}

        try:
            client.messages.create(model=model, max_tokens=999, messages=[msg_in])
        except Exception:
            pass
        else:
            raise Exception("should have raised an exception")

        logs = bgl.pop()
        assert len(logs) == 1
        log = logs[0][0]
        assert log["project_id"] == project_name
        assert "404" in log["error"]


def test_anthropic_client():
    project_name = "test-anthropic-app"
    _setup_test_logger(project_name)

    with logger._internal_with_memory_background_logger() as bgl:
        assert not bgl.pop()

        client = wrap_anthropic_client(_get_anthropic_client())

        model = "claude-3-haiku-20240307"
        msg_in = {"role": "user", "content": "who are you?"}

        start = time.time()
        msg = client.messages.create(model=model, max_tokens=300, messages=[msg_in])
        end = time.time()

        text = msg.content[0].text
        assert text

        # verify we generated the right spans.
        logs = bgl.pop()

        assert len(logs) == 1
        log = logs[0][0]

        assert log["project_id"] == project_name
        assert start < log["metrics"]["start"] < end
        assert start < log["metrics"]["end"] < end
        assert log["span_id"]
        assert log["root_span_id"]
        attrs = log["span_attributes"]
        assert attrs["type"] == "llm"
        assert "anthropic" in attrs["name"]
        metrics = log["metrics"]
        assert start < metrics["start"] < metrics["end"] < end
        assert metrics["tokens"] > 0
        assert metrics["prompt_tokens"] > 0
        assert metrics["completion_tokens"] > 0
