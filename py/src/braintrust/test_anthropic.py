import os
import time

import anthropic

from braintrust import logger
from braintrust.logger import ObjectMetadata, OrgProjectMetadata
from braintrust.util import LazyValue
from braintrust.wrappers.anthropic import wrap_anthropic_client

TEST_ORG_ID = "test-org-123"
TEST_PROJECT_NAME = "test-project-456"


def _setup_test_logger(project_name: str):
    project_metadata = ObjectMetadata(id=project_name + "-id", name=project_name, full_info=dict())
    metadata = OrgProjectMetadata(org_id=TEST_ORG_ID, project=project_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)
    l = logger.init_logger(project=project_name)
    l._lazy_metadata = lazy_metadata  # FIXME[matt] this is cheesy but it stops us from having to login


def _get_anthropic_client():
    return anthropic.Anthropic()


def test_memory_logger():
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


def test_anthropic_client():
    _setup_test_logger("test-anthropic-app")
    with logger._internal_with_memory_background_logger() as bgl:
        assert not bgl.pop()

        start = time.time()

        client = wrap_anthropic_client(_get_anthropic_client())
        msg = client.messages.create(
            model="claude-3-haiku-20240307", max_tokens=300, messages=[{"role": "user", "content": "who are you?"}]
        )
        out = msg.content[0].text
        assert out

        end = time.time()
        logs = bgl.pop()

        assert len(logs) == 1
        log = logs[0][0]

        import pprint

        pprint.pprint(log)
        assert start < log["metrics"]["start"] < end
        assert start < log["metrics"]["end"] < end
