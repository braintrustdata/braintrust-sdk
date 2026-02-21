"""
Simple example showing how to use Google ADK with Braintrust auto-instrumentation.

This is the recommended approach - just call auto_instrument() before using ADK.

Requirements:
    pip install braintrust google-adk

Environment variables:
    BRAINTRUST_API_KEY - Your Braintrust API key
    GOOGLE_API_KEY or GEMINI_API_KEY - Your Google API key
"""

import asyncio

import braintrust
from google.adk import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Initialize Braintrust and auto-instrument all supported libraries
braintrust.init_logger(project="adk-example")
braintrust.auto_instrument()


def get_weather(location: str) -> dict:
    """Get the weather for a location."""
    return {
        "location": location,
        "temperature": "72°F",
        "condition": "sunny",
        "humidity": "45%",
    }


async def main():
    with braintrust.start_span(name="auto") as span:
        # Create an agent with a tool
        agent = Agent(
            name="weather_agent",
            model="gemini-2.0-flash",
            instruction="You are a helpful weather assistant. Use the get_weather tool to answer questions about weather.",
            tools=[get_weather],
        )

        # Set up session
        APP_NAME = "weather_app"
        USER_ID = "demo-user"
        SESSION_ID = "demo-session"

        session_service = InMemorySessionService()
        await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID)

        runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)

        # Send a message
        user_msg = types.Content(role="user", parts=[types.Part(text="What's the weather in San Francisco?")])

        print("Sending message to agent...")
        async for event in runner.run_async(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
            if event.is_final_response():
                text = event.content.parts[0].text if event.content and event.content.parts else "No response"
                print(f"Agent response: {text}")

        print(f"\nView trace: {span.link()}")


if __name__ == "__main__":
    asyncio.run(main())
