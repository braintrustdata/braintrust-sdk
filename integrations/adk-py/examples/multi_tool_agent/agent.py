import datetime
from typing import Dict
from zoneinfo import ZoneInfo

from braintrust import traced
from braintrust_adk import setup_braintrust
from google.adk.agents import LlmAgent


@traced
def isNewYork(city: str) -> bool:
    return city.lower() == "new york"


@traced
def get_weather(city: str) -> Dict[str, str]:
    """Retrieves the current weather report for a specified city.

    Args:
        city (str): The name of the city for which to retrieve the weather report.

    Returns:
        dict: status and result or error msg.
    """
    if isNewYork(city):
        return {
            "status": "success",
            "report": (
                "The weather in New York is sunny with a temperature of 25 degrees Celsius (41 degrees Fahrenheit)."
            ),
        }
    else:
        return {
            "status": "error",
            "error_message": f"Weather information for '{city}' is not available.",
        }


@traced
def get_current_time(city: str) -> Dict[str, str]:
    """Returns the current time in a specified city.

    Args:
        city (str): The name of the city for which to retrieve the current time.

    Returns:
        dict: status and result or error msg.
    """

    if isNewYork(city):
        tz_identifier = "America/New_York"
    else:
        return {
            "status": "error",
            "error_message": (f"Sorry, I don't have timezone information for {city}."),
        }

    tz = ZoneInfo(tz_identifier)
    now = datetime.datetime.now(tz)
    report = f"The current time in {city} is {now.strftime('%Y-%m-%d %H:%M:%S %Z%z')}"
    return {"status": "success", "report": report}


setup_braintrust(project_name="adk-multi-tool")

root_agent = LlmAgent(
    name="weather_time_agent",
    model="gemini-2.0-flash",
    description=("Agent to answer questions about the time and weather in a city."),
    instruction=("You are a helpful agent who can answer user questions about the time and weather in a city."),
    tools=[get_weather, get_current_time],
)
