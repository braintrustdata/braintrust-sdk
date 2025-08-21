from google.adk import Runner
from google.adk.agents import LlmAgent
from google.adk.sessions import InMemorySessionService
from google.genai import types
from opentelemetry.sdk.trace import TracerProvider


def get_weather(city: str) -> dict:
    """Get weather for a city."""
    return {"temperature": 72, "condition": "sunny", "city": city}


def get_current_time() -> str:
    return "04:19 PM"


async def run_weather_agent():
    agent = LlmAgent(
        name="weather_time_assistant",
        tools=[get_weather, get_current_time],
        model="gemini-2.0-flash-exp",
        instruction="You are a helpful assistant that can check weather and time.",
    )

    session_service = InMemorySessionService()
    runner = Runner(app_name="weather_app", agent=agent, session_service=session_service)

    user_id = "user123"
    session_id = "session123"
    await session_service.create_session(app_name="weather_app", user_id=user_id, session_id=session_id)

    new_message = types.Content(
        parts=[types.Part(text="What's the weather like in New York?")],
        role="user",
    )

    return list(
        runner.run(
            user_id=user_id,
            session_id=session_id,
            new_message=new_message,
        )
    )


def force_tracer_provider(provider=None):
    import opentelemetry.trace
    from opentelemetry.util._once import Once

    existing_provider = opentelemetry.trace._TRACER_PROVIDER
    if isinstance(existing_provider, TracerProvider):
        existing_provider.force_flush(timeout_millis=1000)
        existing_provider.shutdown()

    opentelemetry.trace._TRACER_PROVIDER_SET_ONCE = Once()
    opentelemetry.trace._TRACER_PROVIDER = provider
