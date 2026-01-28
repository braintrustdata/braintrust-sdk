"""Test auto_instrument for Google ADK."""

from braintrust.auto import auto_instrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Instrument
results = auto_instrument()
assert results.get("adk") is True, f"Expected adk=True, got {results.get('adk')}"

# 2. Idempotent
results2 = auto_instrument()
assert results2.get("adk") is True, f"Expected adk=True on second call, got {results2.get('adk')}"

# 3. Make API call and verify span
with autoinstrument_test_context("test_auto_adk") as memory_logger:
    import asyncio

    from google.adk import Agent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    async def run_agent():
        agent = Agent(
            name="test_agent",
            model="gemini-2.0-flash",
            instruction="You are a helpful assistant. Be brief.",
        )

        session_service = InMemorySessionService()
        await session_service.create_session(app_name="test_app", user_id="user", session_id="session")

        runner = Runner(agent=agent, app_name="test_app", session_service=session_service)

        user_msg = types.Content(role="user", parts=[types.Part(text="Say hi")])

        responses = []
        async for event in runner.run_async(user_id="user", session_id="session", new_message=user_msg):
            if event.is_final_response():
                responses.append(event)

        return responses

    responses = asyncio.run(run_agent())
    assert len(responses) > 0, "Expected at least one response"

    spans = memory_logger.pop()
    assert len(spans) >= 1, f"Expected at least 1 span, got {len(spans)}"

    # Verify we have task spans (invocation, agent_run)
    span_types = {row["span_attributes"]["type"] for row in spans}
    assert "task" in span_types, f"Expected 'task' spans, got {span_types}"

print("SUCCESS")
