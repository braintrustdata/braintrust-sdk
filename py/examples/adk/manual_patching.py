"""
Example showing how to manually patch Google ADK classes with Braintrust.

In most cases, you should use auto_instrument() instead (see simple_agent.py).
This manual approach is useful when you need more control over the patching.

Requirements:
    pip install braintrust google-adk

Environment variables:
    BRAINTRUST_API_KEY - Your Braintrust API key
    GOOGLE_API_KEY or GEMINI_API_KEY - Your Google API key
"""

import asyncio

from braintrust.logger import init_logger
from braintrust.wrappers.adk import wrap_agent, wrap_flow, wrap_runner
from google.adk import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Initialize Braintrust logger
init_logger(project="adk-manual-example")


# Manually wrap the Agent class
@wrap_agent
class CustomAgent(Agent):
    @property
    def _llm_flow(self):
        return wrap_flow(super()._llm_flow)


# Manually wrap the Runner class
@wrap_runner
class CustomRunner(Runner):
    pass


def say_hello():
    """A simple greeting tool."""
    return {"greeting": "Hello!"}


def get_user_info(name: str):
    """Get detailed user information."""
    return {
        "user": {
            "name": name,
            "profile": {
                "age": 30,
                "location": {"city": "San Francisco", "country": "USA"},
            },
        },
        "status": "active",
    }


async def main():
    agent = CustomAgent(
        name="hello_agent",
        model="gemini-2.0-flash",
        instruction="Use the appropriate tool based on the user's request. For greetings, use say_hello. For user info requests, use get_user_info.",
        tools=[say_hello, get_user_info],
    )

    APP_NAME = "hello_app"
    USER_ID = "demo-user"
    SESSION_ID = "demo-session"

    session_service = InMemorySessionService()
    await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID)

    runner = CustomRunner(agent=agent, app_name=APP_NAME, session_service=session_service)

    # Test greeting
    user_msg = types.Content(role="user", parts=[types.Part(text="Say hello!")])
    print("Sending greeting request...")

    async for event in runner.run_async(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
        if event.is_final_response():
            text = event.content.parts[0].text if event.content and event.content.parts else "No response"
            print(f"Response: {text}")


if __name__ == "__main__":
    asyncio.run(main())
