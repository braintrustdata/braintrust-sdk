# pyright: reportPrivateUsage=false
# pyright: reportMissingParameterType=false
# pyright: reportUnknownMemberType=false
# pyright: reportUnknownParameterType=false
# pyright: reportUnknownVariableType=false
# pyright: reportUnknownArgumentType=false
import pytest
from braintrust import logger
from braintrust.test_helpers import init_test_logger
from braintrust.wrappers.agno import setup_agno
from braintrust.wrappers.test_utils import verify_autoinstrument_script

TEST_ORG_ID = "test-org-123"
PROJECT_NAME = "test-agno-app"


@pytest.fixture
def memory_logger():
    init_test_logger(PROJECT_NAME)
    with logger._internal_with_memory_background_logger() as bgl:
        yield bgl


@pytest.mark.vcr
def test_agno_simple_agent_execution(memory_logger):
    Agent = pytest.importorskip("agno.agent.Agent")
    OpenAIChat = pytest.importorskip("agno.models.openai.OpenAIChat")

    setup_agno(project_name=PROJECT_NAME)

    assert not memory_logger.pop()

    # Create and configure the agent
    agent = Agent(
        name="Author Agent",
        model=OpenAIChat(id="gpt-4o-mini"),
        instructions="You are librarian. Answer the questions by only replying with the author that wrote the book.",
    )

    response = agent.run("Charlotte's Web")

    # Basic assertion that the agent produced a response
    assert response
    assert response.content
    assert len(response.content) > 0

    # Check the spans generated
    spans = memory_logger.pop()
    assert len(spans) > 0

    # More detailed assertions based on expected span structure
    assert len(spans) == 2, f"Expected 2 spans, got {len(spans)}"

    # Check the root span (Agent.run)
    root_span = spans[0]
    assert root_span["span_attributes"]["name"] == "Author Agent.run"
    assert root_span["span_attributes"]["type"].value == "task"
    assert root_span["input"]["run_response"]["input"]["input_content"] == "Charlotte's Web"
    assert root_span["output"]["content"] == "E.B. White"
    assert root_span["output"]["status"] == "COMPLETED"
    assert root_span["output"]["model"] == "gpt-4o-mini"
    assert root_span["output"]["model_provider"] == "OpenAI"

    # Check metrics in root span
    assert "metrics" in root_span
    assert root_span["metrics"]["prompt_tokens"] > 0
    assert root_span["metrics"]["completion_tokens"] > 0
    assert (
        root_span["metrics"]["total_tokens"]
        == root_span["metrics"]["prompt_tokens"] + root_span["metrics"]["completion_tokens"]
    )
    assert root_span["metrics"]["duration"] > 0

    # Check the LLM span (OpenAI.response)
    llm_span = spans[1]
    assert llm_span["span_attributes"]["name"] == "OpenAI.response"
    assert llm_span["span_attributes"]["type"].value == "llm"
    assert llm_span["span_parents"] == [root_span["span_id"]]
    assert llm_span["metadata"]["model"] == "gpt-4o-mini"
    assert llm_span["metadata"]["provider"] == "OpenAI"

    # Check messages in LLM span input
    assert "messages" in llm_span["input"]
    messages = llm_span["input"]["messages"]
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert "librarian" in messages[0]["content"]
    assert messages[1]["role"] == "user"
    assert messages[1]["content"] == "Charlotte's Web"

    # Check LLM span output
    assert llm_span["output"]["content"] == "E.B. White"

    # Check LLM span metrics
    assert llm_span["metrics"]["prompt_tokens"] == 38
    assert llm_span["metrics"]["completion_tokens"] == 4
    assert llm_span["metrics"]["tokens"] == 42


class TestAutoInstrumentAgno:
    """Tests for auto_instrument() with Agno."""

    def test_auto_instrument_agno(self):
        """Test auto_instrument patches Agno and creates spans."""
        verify_autoinstrument_script("test_auto_agno.py")
