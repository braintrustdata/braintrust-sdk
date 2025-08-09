# Braintrust ADK Examples

This directory contains examples demonstrating how to use the `braintrust-adk-py` library for automatic OpenTelemetry tracing integration with Google ADK.

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

## Other Make Commands

- `make test` - Run tests
- `make lint` - Check code style
- `make format` - Format code
- `make clean` - Clean temporary files
- `make help` - Show all available commands
