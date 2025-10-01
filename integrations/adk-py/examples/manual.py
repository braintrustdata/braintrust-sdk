"""
An example showing how to use the `wrap_agent`, `wrap_flow`, and `wrap_runner` functions to manually patch the Google ADK classes.

In most cases you should consider using `setup_adk`, but this may be helpful in specific cases.
"""

import asyncio

from braintrust_adk import wrap_agent, wrap_flow, wrap_runner
from google.adk import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from braintrust.logger import init_logger

init_logger(project="googleadk")


@wrap_agent
class CustomAgent(Agent):
    @property
    def _llm_flow(self):
        return wrap_flow(super()._llm_flow)


@wrap_runner
class CustomRunner(Runner):
    pass


async def main(text: str = "hi"):
    # Tool with complex nested JSON output to test serialization
    def say_hello():
        return {"greeting": "Hello 👋"}

    def get_user_info(name: str):
        """Get detailed user information - tests complex JSON serialization"""
        return {
            "user": {
                "name": name,
                "profile": {
                    "age": 30,
                    "location": {"city": "San Francisco", "country": "USA"},
                    "preferences": ["coding", "reading", "hiking"],
                },
                "metadata": {
                    "created_at": "2024-01-01T00:00:00Z",
                    "last_login": "2024-12-15T10:30:00Z",
                    "settings": {"theme": "dark", "notifications": True},
                },
            },
            "status": "active",
        }

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

    user_msg = types.Content(role="user", parts=[types.Part(text=text)])
    async for event in runner.run_async(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
        if event.is_final_response():
            text = event.content.parts[0].text if event.content and event.content.parts else "No response"
            print(f"Test 1 - Greeting: {text[:100] if text else 'No response'}...")


if __name__ == "__main__":
    asyncio.run(main())
