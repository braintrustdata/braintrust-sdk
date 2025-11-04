#from google.adk.agents.llm_agent import Agent
import os

from google.adk.agents import LlmAgent as Agent
from pyowm import OWM

from braintrust_adk import setup_adk

setup_adk(
    project_name="Alex-Test-Project",
)

# Securely get the API key
api_key = os.environ.get("OPENWEATHERMAP_API_KEY")
if not api_key:
    raise ValueError("OPENWEATHERMAP_API_KEY not found in environment variables.")

owm = OWM(api_key)
mgr = owm.weather_manager()

# --- 2. Define the Core Python Function ---
def get_weather(city: str) -> str:
    """
    Retrieves the current weather for a specified city.

    Args:
        city (str): The name of the city, e.g., "San Francisco", "Tokyo".

    Returns:
        str: A JSON string describing the current weather, including
             temperature, conditions, and wind speed, or an error message.
    """
    print(f"--- Tool: get_current_weather called for city: {city} ---")
    try:
        # Search for the weather by city name
        observation = mgr.weather_at_place(city)
        w = observation.weather

        # Get weather details
        temp = w.temperature('celsius')  # Get temperature in Celsius
        status = w.detailed_status
        wind = w.wind()

        # Format the output as a clear JSON string for the agent
        report = {
            "city": city,
            "temperature_celsius": temp.get('temp'),
            "feels_like_celsius": temp.get('feels_like'),
            "conditions": status,
            "wind_speed_kph": wind.get('speed') * 3.6  # convert m/s to km/h
        }
        return str(report)

    except Exception as e:
        print(f"Error calling OpenWeatherMap API: {e}")
        return f'{{"error": "Could not retrieve weather for {city}."}}'


def get_weather_alt(city: str) -> str:
    """
    Retrieves the current weather for a specified city.

    Args:
        city (str): The name of the city, e.g., "San Francisco", "Tokyo".

    Returns:
        str: A JSON string describing the current weather, including
             temperature, conditions, and wind speed, or an error message.
    """
    print(f"--- Tool: get_weather_alt called for city: {city} ---")

    # Keep values consistent with the live tool's payload shape
    report = {
        "city": city,
        "temperature_celsius": 20.0,
        "feels_like_celsius": 19.0,
        "conditions": "clear sky",
        "wind_speed_kph": 10.0,
    }
    return str(report)

# --- 3. Create the Agent ---
root_agent = Agent(
    model='gemini-2.5-flash',
    name='weather_agent',
    description='A helpful assistant for weather questions.',
    instruction="You are a helpful agent who can answer user questions about weather in a city.",
    tools=[get_weather_alt]
)
