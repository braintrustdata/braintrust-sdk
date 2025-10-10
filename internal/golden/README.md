# Golden Tests

These test files validate the Braintrust SDK's integration with different AI providers by running comprehensive test suites that cover various LLM features.

## Test Files

- `anthropic.ts` - Tests for Anthropic/Claude integration
- `openai.ts` - Tests for OpenAI integration
- `google_genai.py` - Tests for Google Generative AI integration

Each test suite validates:

- Basic and multi-turn completions
- System prompts
- Streaming responses
- Image and document inputs
- Temperature and sampling parameters
- Stop sequences and metadata
- Tool use and function calling
- Mixed content types

## Running Tests

### TypeScript Tests

```bash
pnpm dlx tsx anthropic.ts
pnpm dlx tsx openai.ts
```

### Python Tests

```bash
python google_genai.py
```

## Requirements

Before running the tests, ensure you have the appropriate API keys set as environment variables:

- `BRAINTRUST_API_KEY` to log to braintrust
- `ANTHROPIC_API_KEY` for Anthropic tests
- `OPENAI_API_KEY` for OpenAI tests
- `GOOGLE_API_KEY` for Google Generative AI tests

The tests will automatically log traces to Braintrust projects named `golden-ts-anthropic`, `golden-ts-openai`, and `golden-python-genai` respectively.

## Contributing

### Adding a New Provider

To add tests for a new AI provider:

1. Use `openai.ts` as a reference implementation
2. Provide it as context to an LLM and ask it to create an equivalent file for the new provider
3. Ensure all test cases are covered with provider-specific adaptations
4. Follow the naming convention: `<provider>.ts` or `<provider>.py`

### Adding New Feature Coverage

When adding a new feature (like reasoning, extended context, or new modalities):

1. Add the test case to **all** existing golden test files (`anthropic.ts`, `openai.ts`, `google_genai.py`)
2. Ensure consistency in test structure and naming across providers
3. Update this README to document the new feature coverage

This ensures comprehensive validation across all supported providers and maintains test parity.
