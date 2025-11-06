# Braintrust OTEL Integration Tests

This directory contains integration tests for Braintrust's OpenTelemetry (OTEL) integration features.

## Overview

The integration tests verify that Braintrust works correctly with OpenTelemetry SDKs and distributed tracing scenarios.

## Test Files

- **`distributed-tracing.test.ts`**: Tests distributed tracing flows where Braintrust spans, OTEL spans, and Braintrust spans interact across service boundaries (BT → OTEL → BT).
- **`nodesdk.test.ts`**: Tests the integration of BraintrustSpanProcessor with OpenTelemetry NodeSDK, including span filtering and AI span detection.

## Running Tests

### Locally

```bash
# Install dependencies
cd sdk/js/integration-tests
pnpm install

# Run all tests
pnpm test

# Watch mode
pnpm test:watch
```

### Environment Variables

The tests require:

- `BRAINTRUST_API_KEY`: Your Braintrust API key
- `BRAINTRUST_OTEL_COMPAT`: Set to `"true"` for distributed tracing tests

### CI/CD

Tests are automatically run in CI via two workflows:

**ESM Tests** (`.github/workflows/js-sdk-esm.yaml`):

- Tests the SDK in ES Module mode
- Pull requests that modify `sdk/js/**`
- Pushes to the `main` branch

**CJS Tests** (`.github/workflows/js-sdk-cjs.yaml`):

- Tests the SDK in CommonJS mode
- Pull requests that modify `sdk/js/**`
- Pushes to the `main` branch

## Test Structure

Tests use:

- **Vitest** as the test runner
- **@opentelemetry/api** for OTEL API interactions
- **@opentelemetry/sdk-node** for NodeSDK integration
- **@opentelemetry/sdk-trace-base** for tracer providers
- **@opentelemetry/context-async-hooks** for context management
- **braintrust** SDK for logging and span management

## Key Features Tested

1. **Distributed Tracing**: Verifies that spans can be propagated across service boundaries
2. **Context Propagation**: Tests that OTEL context is correctly maintained through async operations
3. **Span Filtering**: Validates that AI-related spans are correctly identified and filtered
4. **NodeSDK Integration**: Ensures BraintrustSpanProcessor works with OpenTelemetry NodeSDK
5. **Parallel Operations**: Tests concurrent span creation and context handling
6. **Background Logger Verification**: Tests validate span data by draining and inspecting the background logger

## Notes

- Tests have a 30-second timeout to account for network operations
- Integration tests connect to the Braintrust API, so they require valid credentials
- All tests flush spans and wait for processing to ensure data is sent to Braintrust
