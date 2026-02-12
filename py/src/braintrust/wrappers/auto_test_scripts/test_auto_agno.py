"""Test auto_instrument for Agno (no uninstrument available)."""

from braintrust.auto import auto_instrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Instrument
results = auto_instrument()
assert results.get("agno") == True, "auto_instrument should return True for agno"

# 2. Idempotent
results2 = auto_instrument()
assert results2.get("agno") == True, "auto_instrument should still return True on second call"

# 3. Verify methods are wrapped
from agno.agent import Agent
from agno.models.base import Model
from agno.team import Team
from agno.tools.function import FunctionCall


def check_wrapped(klass, private_method, public_method, required=True):
    """Check if at least one method (private or public) is wrapped."""
    wrapped = False
    if private_method and hasattr(klass, private_method):
        if hasattr(getattr(klass, private_method), "__wrapped__"):
            wrapped = True
    if not wrapped and public_method and hasattr(klass, public_method):
        if hasattr(getattr(klass, public_method), "__wrapped__"):
            wrapped = True

    if required:
        assert wrapped, f"{klass.__name__} should have {private_method or public_method} wrapped"
    # If not required and nothing is wrapped, that's okay (method doesn't exist in this version)


# Agent methods
check_wrapped(Agent, "_run", "run", required=True)
check_wrapped(Agent, "_arun", "arun", required=True)
check_wrapped(Agent, "_run_stream", None, required=False)  # Optional - only in 2.4.0
check_wrapped(Agent, "_arun_stream", None, required=False)  # Optional - only in 2.4.0

# Team methods
check_wrapped(Team, "_run", "run", required=True)
check_wrapped(Team, "_arun", "arun", required=True)
check_wrapped(Team, "_run_stream", None, required=False)
check_wrapped(Team, "_arun_stream", None, required=False)

# Model methods (all public, all required)
assert hasattr(Model, "invoke") and hasattr(Model.invoke, "__wrapped__"), "Model.invoke should be wrapped"
assert hasattr(Model, "ainvoke") and hasattr(Model.ainvoke, "__wrapped__"), "Model.ainvoke should be wrapped"
assert hasattr(Model, "invoke_stream") and hasattr(
    Model.invoke_stream, "__wrapped__"
), "Model.invoke_stream should be wrapped"
assert hasattr(Model, "ainvoke_stream") and hasattr(
    Model.ainvoke_stream, "__wrapped__"
), "Model.ainvoke_stream should be wrapped"
assert hasattr(Model, "response") and hasattr(Model.response, "__wrapped__"), "Model.response should be wrapped"
assert hasattr(Model, "aresponse") and hasattr(Model.aresponse, "__wrapped__"), "Model.aresponse should be wrapped"
assert hasattr(Model, "response_stream") and hasattr(
    Model.response_stream, "__wrapped__"
), "Model.response_stream should be wrapped"
assert hasattr(Model, "aresponse_stream") and hasattr(
    Model.aresponse_stream, "__wrapped__"
), "Model.aresponse_stream should be wrapped"

# FunctionCall methods (all public, all required)
assert hasattr(FunctionCall, "execute") and hasattr(
    FunctionCall.execute, "__wrapped__"
), "FunctionCall.execute should be wrapped"
assert hasattr(FunctionCall, "aexecute") and hasattr(
    FunctionCall.aexecute, "__wrapped__"
), "FunctionCall.aexecute should be wrapped"

# 4. Make API call and verify spans
with autoinstrument_test_context("test_auto_agno") as memory_logger:
    from agno.models.openai import OpenAIChat

    agent = Agent(
        name="Test Agent",
        model=OpenAIChat(id="gpt-4o-mini"),
        instructions="You are a helpful assistant. Be brief.",
    )

    response = agent.run("Say hi")
    assert response, "Agent should return a response"
    assert response.content, "Response should have content"

    spans = memory_logger.pop()
    assert len(spans) >= 2, f"Expected at least 2 spans (agent + model), got {len(spans)}"

    # Verify we have an agent span (type: task)
    agent_spans = [s for s in spans if "Test Agent" in s.get("span_attributes", {}).get("name", "")]
    assert len(agent_spans) >= 1, "Should have at least one agent span"

    # Verify agent span is type TASK
    agent_span = agent_spans[0]
    assert agent_span.get("span_attributes", {}).get("type", {}).value == "task", "Agent span should be type 'task'"

    # Verify we have a model span (type: llm)
    llm_spans = [s for s in spans if s.get("span_attributes", {}).get("type", {}).value == "llm"]
    assert len(llm_spans) >= 1, f"Should have at least one LLM span, got {len(llm_spans)}"

    # Verify model span has expected attributes
    llm_span = llm_spans[0]
    assert "OpenAI" in llm_span.get("span_attributes", {}).get("name", ""), "LLM span should contain 'OpenAI'"
    assert llm_span.get("metadata", {}).get("provider") == "OpenAI", "LLM span should have OpenAI provider"

    # Verify span hierarchy - LLM span should be child of agent span
    llm_parents = llm_span.get("span_parents", [])
    agent_span_id = agent_span.get("span_id")
    assert agent_span_id in llm_parents, f"LLM span should be child of agent span. Agent ID: {agent_span_id}, LLM parents: {llm_parents}"

    print(f"✓ Agent span created (type: task)")
    print(f"✓ Model span created (type: llm)")
    print(f"✓ Span hierarchy verified (model is child of agent)")

print("SUCCESS")
