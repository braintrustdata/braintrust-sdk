# SDK Spec Test Runner (Python)

This directory contains the Python test runner for cross-language SDK specification tests.

## Overview

The spec test system enables cross-language testing of SDK behavior by:

1. **Defining tests in YAML** - Test specifications live in `sdkspec/test/` (eventually a separate repo)
2. **Making real AI API calls** - Executes actual API calls to AI providers (OpenAI, Anthropic, etc.)
3. **Validating Braintrust spans** - Validates that spans are captured correctly in the Braintrust API with expected attributes

## Test Specification Format

Each YAML spec defines:

- **vendor** - AI provider (OpenAI, Anthropic, etc.)
- **endpoint** - API endpoint to call (completions, embeddings, etc.)
- **request** - Request parameters to send to the AI provider
- **braintrust_span** - Expected Braintrust span structure to validate

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
- ✅ Making real OpenAI API calls
- ✅ Capturing Braintrust spans
- ✅ Validating span attributes with regex support
- ✅ Exponential backoff retry for span fetching
- 🚧 Additional vendor support (Anthropic, etc.)
