# Braintrust ADK Examples

This directory contains examples demonstrating how to use the `braintrust-adk` library for logging Google ADK traces to Braintrust.

## Running the Examples

The easiest way to run the examples is using the development server:

```bash
cd examples
make dev
```

This starts the ADK web interface on port 8888 where you can interact with the example agents.

You can also specify a different port:

```bash
make dev PORT=3000
```

## Examples

### `multi_tool_agent/`

Demonstrates how to build multi-tool agents with the ADK and automatic tracing integration.

### `parallel/`

Shows how tracing works with concurrent Google ADK operations and proper trace correlation across async/threaded code.

### `mcp_tracing/`

Demonstrates automatic tracing of MCP (Model Context Protocol) tool invocations. This example shows how `setup_adk()` automatically captures MCP tool calls, including tool name, parameters, results, and duration.

**Requirements:** Python 3.10+ (MCP requirement), Node.js with npx

**Run directly:**

```bash
cd mcp_tracing
export BRAINTRUST_API_KEY=your_key
export GOOGLE_API_KEY=your_key
uv run python agent.py
```

## Setup

Install dependencies:

```bash
make install
```

## Environment Variables

Set these to enable different tracing backends:

- `BRAINTRUST_API_KEY` - Enable Braintrust tracing
- `OTEL_DEBUG=true` - Enable console tracing (good for testing)
- `GOOGLE_CLOUD_PROJECT` - Enable Google Cloud Trace
- `OTEL_EXPORTER_OTLP_ENDPOINT` - Enable OTLP tracing
