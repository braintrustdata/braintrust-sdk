from braintrust_adk.agent import Agent
from google.adk.agents import ParallelAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types


# Define some example tools
def get_weather(city: str) -> str:
    """Gets the current weather for a city."""
    return f"The weather in {city} is sunny."


def get_news(topic: str) -> str:
    """Gets the latest news on a topic."""
    return f"Latest news about {topic}: Everything is great!"


# Create individual agents for different tasks
weather_agent = Agent(
    name="weather_agent",
    model="gemini-2.0-flash",
    tools=[get_weather],
    instruction=(
        "Extract the city name from the user query, call get_weather(city), and return only that result."
    ),
    description="Provides weather information",
    output_key="weather_info",
)
news_agent = Agent(
    name="news_agent",
    model="gemini-2.0-flash",
    tools=[get_news],
    instruction=(
        "Extract the topic from the user query, call get_news(topic), and return only that result."
    ),
    description="Provides news updates",
    output_key="news_info",
)
# Create a parallel agent with proper agents as sub-agents
parallel_agent = ParallelAgent(
    name="parallel_fetcher",
    sub_agents=[weather_agent, news_agent],
    description="Fetch weather & news at the same time",
)
# Set up runner and session for execution
APP_NAME = "parallel_app"
USER_ID = "user_123"
SESSION_ID = "session_456"
# Create session service and session
session_service = InMemorySessionService()
session = session_service.create_session(
    app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID
)
# Create runner
runner = Runner(
    agent=parallel_agent, app_name=APP_NAME, session_service=session_service
)


# Run the parallel agent using the runner
def run_parallel_agent(query):
    # Create content from user query
    content = types.Content(role="user", parts=[types.Part(text=query)])
    replies = []
    # Run the agent with the runner
    for event in runner.run(
        user_id=USER_ID, session_id=SESSION_ID, new_message=content
    ):
        if event.content:
            replies.append(event.content.parts[0].text)
    return replies


# Example usage
result = run_parallel_agent("Berlin")
print(result)
