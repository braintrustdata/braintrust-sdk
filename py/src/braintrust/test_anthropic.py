from braintrust import logger
from braintrust.logger import ObjectMetadata, OrgProjectMetadata
from braintrust.util import LazyValue

TEST_ORG_ID = "test-org-123"
TEST_PROJECT_NAME = "test-project-456"


def _setup_test_logger(project_name: str):
    project_metadata = ObjectMetadata(id=project_name + "-id", name=project_name, full_info=dict())
    metadata = OrgProjectMetadata(org_id=TEST_ORG_ID, project=project_metadata)
    lazy_metadata = LazyValue(lambda: metadata, use_mutex=False)
    l = logger.init_logger(project=project_name)
    l._lazy_metadata = lazy_metadata  # FIXME[matt] this is cheesy but it stops us from having to login
    return l


def test_anthropic():
    _setup_test_logger("test-anthropic-app")

    with logger._internal_with_memory_background_logger() as bgl:

        @logger.traced
        def thing():
            return "hello"

        thing()

        logs = bgl.clear()
        for log in logs:
            print(log.get())
