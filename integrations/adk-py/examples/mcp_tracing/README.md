# MCP Tool Tracing Example

This example demonstrates automatic tracing of MCP tool invocations using braintrust-adk.

## What Gets Traced

With `setup_adk()`, you automatically get traces for:

1. **Agent execution** - The full agent run
2. **LLM calls** - Tool selection and response generation
3. **MCP tool invocations** - Tool name, parameters, and results

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

3. Run the example:
   ```bash
   python agent.py
   ```

## View Traces

Visit [https://www.braintrust.dev/app](https://www.braintrust.dev/app) and look for project **"adk-mcp-example"**.

You'll see a complete trace hierarchy:

```
invocation [filesystem_app]
├─ agent_run [filesystem_assistant]
│  ├─ call_llm
│  │  └─ llm_call [tool_selection]
│  │     output: {function_call: {name: "list_directory", args: {...}}}
│  ├─ mcp_tool [list_directory]
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

Regular Python function tools (like in `multi_tool_agent/`) are traced automatically.

MCP tools connect to external servers and required the new `wrap_mcp_tool()` functionality to capture their execution details. This example demonstrates that MCP tools are now traced just as seamlessly.
