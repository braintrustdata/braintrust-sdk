from typing import Any, Dict

from braintrust import logger
from braintrust.logger import ObjectMetadata, OrgProjectMetadata
from braintrust.util import LazyValue

TEST_ORG_ID = "test-org-id"


def simulate_login(project_name: str):
    project_metadata = ObjectMetadata(id=project_name, name=project_name, full_info=dict())
    metadata = OrgProjectMetadata(org_id=TEST_ORG_ID, project=project_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)
    l = logger.init_logger(project=project_name)
    l._lazy_metadata = lazy_metadata  # FIXME[matt] this is cheesy but it stops us from having to login


def assert_metrics_are_valid(metrics: Dict[str, Any]):
    assert metrics
    # assert 0 < metrics["time_to_first_token"]
    assert 0 < metrics["tokens"]
    assert 0 < metrics["prompt_tokens"]
    assert 0 < metrics["completion_tokens"]
