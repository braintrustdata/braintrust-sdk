import asyncio

from braintrust_adk import setup_braintrust
from google.adk import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

setup_braintrust(project_name="googleadk")


async def main():
    # Tool with complex nested JSON output to test serialization
    def say_hello():
        return {"greeting": "Hello Langfuse 👋"}

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

    agent = Agent(
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

    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)

    # Test 1: Simple greeting with nested spans (input/output bubbling)
    user_msg = types.Content(role="user", parts=[types.Part(text="hi")])
    for event in runner.run(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
        if event.is_final_response():
            text = event.content.parts[0].text if event.content and event.content.parts else "No response"
            print(f"Test 1 - Greeting: {text[:100] if text else 'No response'}...")

    # # Test 2: Complex tool call to test JSON serialization
    # user_msg = types.Content(role="user", parts=[types.Part(text="Get info for user John")])
    # for event in runner.run(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
    #     if event.is_final_response():
    #         text = event.content.parts[0].text if event.content and event.content.parts else "No response"
    #         print(f"Test 2 - Tool call: {text[:100] if text else 'No response'}...")

    # # Test 3: Repeated calls to test cached token counting
    # test_message = "What's the weather like?"
    # for i in range(3):
    #     user_msg = types.Content(role="user", parts=[types.Part(text=test_message)])
    #     for event in runner.run(user_id=USER_ID, session_id=SESSION_ID, new_message=user_msg):
    #         if event.is_final_response():
    #             text = event.content.parts[0].text if event.content and event.content.parts else "No response"
    #             print(f"Test 3.{i + 1}: {text[:80] if text else 'No response'}...")


asyncio.run(main())
