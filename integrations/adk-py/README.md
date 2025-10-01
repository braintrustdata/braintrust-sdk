# braintrust-adk

SDK for integrating [Braintrust](https://braintrust.dev) with [Google ADK (Agent Development Kit)](https://github.com/google/adk-python). This package provides automatic tracing and logging of ADK agent executions to Braintrust.

## Installation

```bash
pip install braintrust-adk
```

## Requirements

- Python >= 3.9
- Google ADK >= 1.14.1

## Quick Start

The `braintrust-adk` integration automatically traces your ADK agents' execution, including:

- Agent invocations and responses
- Tool calls and their results
- Parallel execution flows
- Multi-step agent reasoning

### Basic Usage

```python
from google.adk.agents import LlmAgent
from braintrust_adk import setup_adk

# Initialize Braintrust tracing
setup_adk(
    api_key="your-api-key",  # Or set BRAINTRUST_API_KEY env var
    project_name="my-adk-project"  # Optional: defaults to "default-google-adk-py"
)

# Create your ADK agent as normal
agent = LlmAgent(
    tools=[get_weather, get_current_time],
    model="gemini-2.0-flash-exp",
    system_instruction="You are a helpful assistant that can check weather and time."
)

# Use the agent - all interactions are automatically traced to Braintrust
response = agent.send_message("What's the weather like in New York?")
print(response.text)
```

### Advanced Configuration

#### Using Project ID

If you know your Braintrust project ID, you can use it directly:

```python
setup_adk(
    api_key="your-api-key",
    project_id="your-project-id"  # Use project ID instead of name
)
```

#### Custom Tools with Tracing

Other braintrust functions like `traced` work seamlessly with this integration.

```python
from braintrust import traced

@traced
def get_weather(city: str) -> dict:
    """Get weather for a city."""
    # Your implementation here
    return {"status": "success", "temperature": 72, "city": city}

@traced
def search_flights(origin: str, destination: str, date: str) -> dict:
    """Search for flights."""
    # Your implementation here
    return {"flights": [...]}

# Create agent with multiple tools
agent = LlmAgent(
    tools=[get_weather, search_flights],
    model="gemini-2.0-flash-exp",
    system_instruction="You are a travel assistant."
)

# All tool calls are automatically traced
response = agent.send_message(
    "I need to fly from NYC to LA tomorrow. What's the weather like in LA?"
)
```

### Manual Patching

The `setup_adk` will automatically patch Google ADK Runner, Agent, and Flow classes to automatically trace all agent interactions. If you prefer to manually patch classes, you can use the `wrap_agent`, `wrap_runner`, and `wrap_flow` functions. Take a look at the [manual example](./examples/manual.py).

Note that, as of writing, `adk web` does not support [custom Runners](https://github.com/google/adk-web/issues/72) and you will need to use `setup_adk` if you would like LLM traces.

## Examples

The `examples/` directory contains complete working examples:

## Viewing Traces in Braintrust

Once you've set up the integration, you can view your traces in the Braintrust dashboard:

1. Navigate to your project in [Braintrust](https://braintrust.dev)
2. Click on "Logs" to see all agent executions
3. Click on any log entry to see the full trace including:
   - Agent reasoning steps
   - Tool calls and responses
   - Token usage and latency metrics
   - Any errors or warnings

## Development

To contribute to this integration:

```bash
# Clone the repository
git clone https://github.com/braintrustdata/braintrust-sdk.git
cd sdk/integrations/adk-py

uv sync

# Run examples
cd examples

# simple programmatic agent call
uv run manual.py

# or use the adk web UI
uv run adk web --port 8888
```

## Related Resources

- [Braintrust Documentation](https://www.braintrust.dev/docs)
- [Google ADK Documentation](https://github.com/google/genai-agent-dev-kit)
