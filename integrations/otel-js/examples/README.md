# Braintrust OpenTelemetry Examples

This directory examples demonstrating how to use `@braintrust/otel` with different versions of OpenTelemetry.

## Directory Structure

- **`otel-v1/`** - Examples for OpenTelemetry v1.x
- **`otel-v2/`** - Examples for OpenTelemetry v2.x

## Quick Start

Each example directory is a self-contained package. To get started:

```bash
# Navigate to the version you want to try
cd otel-v1  # or otel-v2

# Install dependencies
pnpm install

# Run a specific example
pnpm run example:nodesdk

# Or run all examples
pnpm run example:all
```

## OpenTelemetry v1.x Examples

Located in `otel-v1/`.

### Available Examples

- **`nodesdk_example.ts`** - Using the OpenTelemetry `NodeSDK` with `BraintrustSpanProcessor`.

- **`aisdk_example.ts`** - Integration with the Vercel AI SDK, demonstrating how AI operations are automatically traced and sent to Braintrust. Requires `OPENAI_API_KEY`.

- **`custom_otel_example.ts`** - Custom `BasicTracerProvider` configuration with AI span filtering enabled. Shows how to filter out non-AI spans to reduce noise.

- **`distributed-tracing.ts`** - Demonstrates distributed tracing across multiple services, showing how Braintrust and OpenTelemetry spans can be mixed in a unified trace.

- **`otel_compat.ts`** - Comprehensive compatibility demonstration showing bidirectional interoperability between Braintrust and OpenTelemetry spans in the same trace.

- **`vercel_ai_sdk_example.ts`** - Example using the Vercel AI SDK with Braintrust OpenTelemetry integration.

### Running v1 Examples

```bash
cd otel-v1
pnpm install

# Run individual examples
pnpm run example:nodesdk      # Basic NodeSDK setup
pnpm run example:aisdk         # AI SDK integration (requires OPENAI_API_KEY)
pnpm run example:custom       # Custom provider with filtering
pnpm run example:distributed   # Distributed tracing demo
pnpm run example:compat        # Compatibility demonstration
pnpm run example:vercel-ai     # Vercel AI SDK example

# Run all examples
pnpm run example:all
```

## OpenTelemetry v2.x Examples

Located in `otel-v2/`.

### Available Examples

- **`nodesdk_example.ts`** - Using the OpenTelemetry `NodeSDK` with `BraintrustSpanProcessor`.

- **`custom_otel_example.ts`** - Custom `BasicTracerProvider` configuration with AI span filtering enabled. Shows how to filter out non-AI spans to reduce noise.

- **`distributed-tracing.ts`** - Demonstrates distributed tracing across multiple services, showing how Braintrust and OpenTelemetry spans can be mixed in a unified trace.

### Running v2 Examples

```bash
cd otel-v2
pnpm install

# Run individual examples
pnpm run example:nodesdk      # Basic NodeSDK setup
pnpm run example:custom       # Custom provider with filtering
pnpm run example:distributed  # Distributed tracing demo

# Run all examples
pnpm run example:all
```

## Requirements

All examples require the following environment variables:

- **`BRAINTRUST_API_KEY`** (required) - Your Braintrust API key for authentication
- **`BRAINTRUST_PARENT`** (optional) - Parent project identifier in format `project_name:my_project`.

### Additional Requirements

Some examples have additional requirements:

- **`aisdk_example.ts`** (v1 only) - Requires `OPENAI_API_KEY` environment variable to make actual API calls
- **`vercel_ai_sdk_example.ts`** (v1 only) - Requires `OPENAI_API_KEY` environment variable

## What You'll Learn

These examples demonstrate:

- ✅ How to configure `BraintrustSpanProcessor` with OpenTelemetry
- ✅ How to filter AI spans to reduce noise from non-AI operations
- ✅ How to enable bidirectional interoperability between Braintrust and OpenTelemetry
- ✅ How to propagate trace context across service boundaries
- ✅ How to mix Braintrust and OpenTelemetry spans in unified traces

## Next Steps

After running these examples:

1. Check your [Braintrust dashboard](https://braintrust.dev) to see the traces
2. Review the [main README](../README.md) for detailed API documentation
3. Explore the [Braintrust OpenTelemetry guide](https://www.braintrust.dev/docs/integrations/sdk-integrations/opentelemetry) for more advanced patterns
