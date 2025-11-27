# Braintrust OpenTelemetry Examples

This directory contains examples for using `@braintrust/otel` with different versions of OpenTelemetry.

## Directory Structure

- `otel-v1/` - Examples for OpenTelemetry v1.x
- `otel-v2/` - Examples for OpenTelemetry v2.x

## OpenTelemetry v1.x Examples

Located in `otel-v1/`, these examples use OpenTelemetry 1.x packages:

- **nodesdk_example.ts** - Basic NodeSDK example with BraintrustSpanProcessor
- **aisdk_example.ts** - AI SDK integration example (requires `OPENAI_API_KEY`)
- **custom_otel_example.ts** - Custom BasicTracerProvider example with filtering
- **distributed-tracing.ts** - Distributed tracing across services
- **otel_compat.ts** - BT + OTEL compatibility demonstration
- **vercel_ai_sdk_example.ts** - Using vercel ai sdk with braintrust otel

### Running v1 Examples

```bash
cd otel-v1
npm install
npm run example:nodesdk      # Run nodesdk example
npm run example:aisdk         # Run AI SDK example
npm run example:custom        # Run custom example
npm run example:distributed   # Run distributed tracing example
npm run example:compat        # Run compatibility example
npm run example:all           # Run all examples
```

## OpenTelemetry v2.x Examples

Located in `otel-v2/`, these examples use OpenTelemetry 2.x packages:

- **nodesdk_example.ts** - Basic NodeSDK example with BraintrustSpanProcessor (v2.x)

### Running v2 Examples

```bash
cd otel-v2
npm install
npm run example:nodesdk       # Run nodesdk example
npm run example:all           # Run all examples
```

## Key Differences Between v1 and v2

### OpenTelemetry v1.x

- Uses `addSpanProcessor()` method on BasicTracerProvider
- Uses `parentSpanId` property on spans
- Uses `instrumentationLibrary` property
- Package versions: `@opentelemetry/sdk-trace-base@1.9.0`, `@opentelemetry/resources@1.30.1`, etc.

### OpenTelemetry v2.x

- Uses `spanProcessors` array in constructor config
- Uses `parentSpanContext` object on spans
- Uses `instrumentationScope` property
- Package versions: `@opentelemetry/sdk-trace-base@2.0.0`, `@opentelemetry/resources@2.0.0`, etc.

## Requirements

All examples require:

- `BRAINTRUST_API_KEY` environment variable set
- `BRAINTRUST_PARENT` environment variable (optional, defaults to `project_name:default-otel-project`)

Additional requirements:

- **aisdk_example.ts** requires `OPENAI_API_KEY` environment variable to be set

## Installation

Install dependencies for all examples:

```bash
npm run install:all
```

Or install for a specific version:

```bash
npm run install:v1  # Install v1 dependencies
npm run install:v2  # Install v2 dependencies
```
