"""Test auto_instrument for Agno (no uninstrument available)."""

from braintrust.auto import auto_instrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Instrument
results = auto_instrument()
assert results.get("agno") == True

# 2. Idempotent
results2 = auto_instrument()
assert results2.get("agno") == True

# 3. Make API call and verify span
with autoinstrument_test_context("test_auto_agno") as memory_logger:
    from agno.agent import Agent
    from agno.models.openai import OpenAIChat

    agent = Agent(
        name="Test Agent",
        model=OpenAIChat(id="gpt-4o-mini"),
        instructions="You are a helpful assistant. Be brief.",
    )

    response = agent.run("Say hi")
    assert response
    assert response.content

    spans = memory_logger.pop()
    assert len(spans) >= 1, f"Expected at least 1 span, got {len(spans)}"

print("SUCCESS")
