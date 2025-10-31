# MCP Tool Tracing Example

This example demonstrates automatic tracing of MCP tool invocations using braintrust-adk.

## What Gets Traced

With `setup_adk()`, you automatically get traces for:

1. **Agent execution** - The full agent run
2. **LLM calls** - Tool selection and response generation
3. **MCP tool invocations** - Tool name, parameters, results (NEW!)

## Setup

**Requirements:** Python 3.10+ (MCP requirement)

1. Install dependencies:
   ```bash
   cd examples/mcp_tracing
   uv sync
   ```

2. Set environment variables:
   ```bash
   export BRAINTRUST_API_KEY=your_key_here
   export GOOGLE_API_KEY=your_key_here
   ```

3. Run the server:
   ```bash
   uvicorn fastapi_mcp_example:app --reload
   ```

## Test It

```bash
curl -X POST "http://localhost:8000/ask" \
  -H "Content-Type: application/json" \
  -d '{"question": "List files in /tmp"}'
```

## View Traces

Visit [https://www.braintrust.dev/app](https://www.braintrust.dev/app) and look for:

```
invocation [filesystem_app]
├─ agent_run [filesystem_assistant]
│  ├─ call_llm
│  │  └─ llm_call [tool_selection]
│  │     output: {function_call: {name: "list_directory", args: {...}}}
│  ├─ mcp_tool [list_directory]        ← NEW!
│  │  input: {tool_name: "list_directory", arguments: {path: "/tmp"}}
│  │  output: {content: [...]}
│  │  duration: 45ms
│  └─ llm_call [response_generation]
│     input: {function_response: {...}}
```

## Key Points

- **Zero manual tracing** - Just call `setup_adk()` once at startup
- **Complete visibility** - See exactly which MCP tools are called with what parameters
- **Error tracking** - Failures are captured in the trace
- **Performance monitoring** - See tool execution duration

## Comparing with Regular Tools

The customer's original example (`fastapi_adk.py`) uses regular Python functions as tools:

```python
def get_weather(city: str) -> dict:
    """Get weather for a city."""
    return {"temperature": 72, "condition": "sunny"}
```

This example uses **MCP tools** which connect to external servers:

```python
MCPToolset(
    connection_params=StdioConnectionParams(...),
    tool_filter=["list_directory", "read_file"],
)
```

Both are automatically traced by `setup_adk()`, but MCP tools required the new `wrap_mcp_tool()` functionality to capture their execution details.
