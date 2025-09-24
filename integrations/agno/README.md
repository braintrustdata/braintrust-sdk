# Braintrust Agno Integration

Automatic observability for Agno agents with zero-code instrumentation.

## Overview

The Braintrust Agno integration provides comprehensive tracing and monitoring for your Agno agents, models, and tool calls. With a single line of code, you get:

- **Agent execution tracing** - Full visibility into agent workflows with proper span hierarchies
- **LLM call monitoring** - Track all model invocations with token usage and latency
- **Tool call observability** - Monitor function calls with inputs, outputs, and timing
- **Error tracking** - Automatic capture of errors and exceptions
- **Performance metrics** - Latency, token usage, and throughput measurements

## Installation

```bash
pip install braintrust-agno
```

Or using uv:

```bash
uv pip install braintrust-agno
```

## Quick Start

```python
from braintrust_agno import init_agno
import agno

# Initialize Braintrust integration
init_agno(project_name="my-agno-project")

# Your existing Agno code works automatically with tracing
agent = agno.Agent(
    name="MyAssistant",
    model="gpt-4",
    instructions="You are a helpful assistant.",
    tools=[...],
)

# All agent operations are now traced
response = agent.run(messages=[
    {"role": "user", "content": "Hello, how can you help me?"}
])
```

That's it! Your agent interactions are now being traced to Braintrust.

## Configuration

### Environment Variables

- `BRAINTRUST_API_KEY` - Your Braintrust API key
- `BRAINTRUST_PROJECT` - Default project name

### Initialization Options

```python
init_agno(
    api_key="your-api-key",        # Optional: Uses env var if not provided
    project_id="project-uuid",     # Optional: Use project ID instead of name
    project_name="my-project",     # Optional: Uses env var if not provided
)
```

## Usage Examples

### Basic Agent Tracing

```python
from braintrust_agno import init_agno
import agno

# Initialize once at startup
init_agno()

# Create your agent
agent = agno.Agent(
    name="CustomerSupport",
    model="gpt-4",
    instructions="Help customers with their inquiries.",
)

# Use normally - all operations are traced
response = agent.run(messages=[...])
```

### With Experiments

```python
from braintrust_agno import init_agno
from braintrust import init_experiment
import agno

init_agno()

# Run experiments with automatic tracing
experiment = init_experiment(
    project="agno-experiments",
    experiment="agent-performance",
)

agent = agno.Agent(...)

for test_case in test_cases:
    response = agent.run(messages=test_case["messages"])

    experiment.log(
        input=test_case["messages"],
        output=response.content,
        expected=test_case["expected"],
    )

experiment.summarize()
```

### Team Agents

```python
from braintrust_agno import init_agno
import agno

init_agno()

# Team agents with multiple models are fully traced
team = agno.TeamAgent(
    agents=[
        agno.Agent(name="Researcher", model="gpt-4", ...),
        agno.Agent(name="Writer", model="claude-3", ...),
        agno.Agent(name="Reviewer", model="gpt-4", ...),
    ]
)

# Traces show the full workflow across all agents
result = team.collaborate(task="Write a blog post about AI")
```

### Streaming Responses

```python
from braintrust_agno import init_agno
import agno

init_agno()

agent = agno.Agent(...)

# Streaming is fully supported
for chunk in agent.run_stream(messages=[...]):
    print(chunk.content, end="")
    # Each chunk is traced with timing information
```

### Custom Tools

```python
from braintrust_agno import init_agno
import agno

init_agno()

def search_database(query: str) -> str:
    # Tool execution is automatically traced
    return database.search(query)

agent = agno.Agent(
    name="DataAssistant",
    model="gpt-4",
    tools=[search_database],
)

# Tool calls appear as nested spans
response = agent.run(messages=[
    {"role": "user", "content": "Find all customers from New York"}
])
```

## What Gets Traced

### Agent Operations

- `agent.run()` - Synchronous agent execution
- `agent.arun()` - Async agent execution
- `agent.run_stream()` - Streaming responses
- `agent.arun_stream()` - Async streaming
- `agent.print_response()` - Response formatting

### Model Invocations

- `model.invoke()` - Direct model calls
- `model.response()` - Response generation
- `model.invoke_stream()` - Streaming model calls
- Token usage and costs
- Latency measurements

### Tool/Function Calls

- `function.execute()` - Tool execution
- Input parameters
- Output results
- Execution time
- Error handling

## API Reference

### `init_agno(api_key=None, project_id=None, project_name=None)`

Initialize the Braintrust Agno integration.

**Parameters:**

- `api_key` (str, optional): Braintrust API key. Uses `BRAINTRUST_API_KEY` env var if not provided.
- `project_id` (str, optional): Braintrust project UUID.
- `project_name` (str, optional): Braintrust project name. Uses `BRAINTRUST_PROJECT` env var if not provided.

**Returns:**

- `bool`: True if initialization succeeded, False otherwise.

### `setup_braintrust(...)`

Lower-level setup function with the same parameters as `init_agno()`. Most users should use `init_agno()` instead.

### `teardown_braintrust()`

Remove all Braintrust instrumentation from Agno classes. Useful for testing or cleanup.

## Development

### Running Tests

```bash
# Install development dependencies
uv pip install -e ".[dev]"

# Run tests
pytest tests/

# Run with coverage
pytest tests/ --cov=braintrust_agno
```

### Building from Source

```bash
# Clone the repository
git clone https://github.com/braintrustdata/braintrust-sdk
cd braintrust-sdk/sdk/integrations/agno

# Install in editable mode
uv pip install -e .
```

### Project Structure

```
agno/
├── src/
│   └── braintrust_agno/
│       ├── __init__.py       # Main integration entry point
│       ├── agent.py          # Agent wrapper implementation
│       ├── model.py          # Model wrapper implementation
│       ├── function_call.py  # Function call wrapper
│       └── base.py           # Base wrapper utilities
├── tests/                    # Test suite
├── examples/                 # Usage examples
│   ├── simple_agent.py      # Basic agent example
│   └── team_agent.py        # Multi-agent example
├── pyproject.toml           # Package configuration
└── README.md                # This file
```

## Troubleshooting

### No traces appearing

1. Verify your API key is set:

   ```python
   import os
   assert os.getenv("BRAINTRUST_API_KEY"), "API key not set"
   ```

2. Check initialization succeeded:
   ```python
   from braintrust_agno import init_agno
   success = init_agno()
   assert success, "Initialization failed"
   ```

### Import errors

If you see import errors, ensure both packages are installed:

```bash
pip install braintrust-agno agno
```

### Performance considerations

The integration adds minimal overhead (typically <1ms per operation). For high-throughput applications, you can disable tracing:

```python
from braintrust_agno import teardown_braintrust

# Disable tracing temporarily
teardown_braintrust()

# ... performance-critical code ...

# Re-enable tracing
init_agno()
```

## Support

- [Documentation](https://www.braintrust.dev/docs)
- [GitHub Issues](https://github.com/braintrustdata/braintrust-sdk/issues)
- [Discord Community](https://discord.gg/braintrust)

## License

Apache 2.0 - See [LICENSE](https://github.com/braintrustdata/braintrust-sdk/blob/main/LICENSE) for details.
