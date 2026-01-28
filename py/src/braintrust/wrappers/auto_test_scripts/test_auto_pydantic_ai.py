"""Test auto_instrument for Pydantic AI (no uninstrument available)."""

from braintrust.auto import auto_instrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Instrument
results = auto_instrument()
assert results.get("pydantic_ai") == True

# 2. Idempotent
results2 = auto_instrument()
assert results2.get("pydantic_ai") == True

# 3. Make API call and verify span
with autoinstrument_test_context("test_auto_pydantic_ai") as memory_logger:
    from pydantic_ai import Agent
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.settings import ModelSettings

    agent = Agent(
        OpenAIChatModel("gpt-4o-mini"),
        model_settings=ModelSettings(max_tokens=100),
    )

    import asyncio
    result = asyncio.run(agent.run("Say hi"))
    assert result.output

    spans = memory_logger.pop()
    assert len(spans) >= 1, f"Expected at least 1 span, got {len(spans)}"
    # Find the agent_run span
    agent_spans = [s for s in spans if "agent_run" in s["span_attributes"]["name"]]
    assert len(agent_spans) >= 1, f"Expected agent_run span, got {[s['span_attributes']['name'] for s in spans]}"

print("SUCCESS")
