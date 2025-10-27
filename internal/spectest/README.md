# SDK Spec Test Runner (Python)

This directory contains the Python test runner for cross-language SDK specification tests.

## Overview

The spec test system enables cross-language testing of SDK behavior by:

1. **Defining tests in YAML** - Test specifications live in `sdkspec/test/` (eventually a separate repo)
2. **Mocking AI vendor responses** - Uses wiremock-style configuration to mock HTTP responses
3. **Capturing OpenTelemetry spans** - Validates that SDKs generate correct OTel instrumentation
4. **Validating Braintrust spans** - Optionally checks that spans appear correctly in the Braintrust API

## Test Specification Format

Each YAML spec defines:

- **vendor** - AI provider (OpenAI, Anthropic, etc.)
- **endpoint** - API endpoint to call (completions, embeddings, etc.)
- **request** - Request parameters to send
- **wiremock** - Mock HTTP response configuration
- **otel_span** - Expected OpenTelemetry span attributes
- **braintrust_span** - Expected Braintrust span structure (optional)

## Usage

### Run via pytest (automatic discovery)

```bash
pytest  # Automatically discovers and runs .yaml specs in sdkspec/test/
```

### Run directly

```bash
python runner.py ../../sdkspec/test/test-openai.yaml
```

## Architecture

- `runner.py` - Core test runner implementation
- Specs live in `../../sdkspec/test/` (relative to this directory)
- Each language SDK has its own runner implementation in `internal/spectest/`

## Current Status

The runner currently supports:

- ✅ Loading YAML specs
- ✅ Mocking HTTP responses
- ✅ Capturing OTel spans
- ✅ Basic span validation
- 🚧 SDK invocation (needs implementation per vendor)
- 🚧 Braintrust API span validation
