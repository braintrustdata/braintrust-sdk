# Golden Tests

These test files validate the Braintrust SDK's integration with different AI providers by running comprehensive test suites that cover various LLM features.

## Test Files

- `anthropic.ts` - Tests for Anthropic/Claude integration
- `openai.ts` - Tests for OpenAI integration
- `google_genai.py` - Tests for Google Generative AI integration
- `ai-sdk.ts` - Tests for AI SDK (Vercel) integration across multiple versions

Each test suite validates:

- Basic and multi-turn completions
- System prompts
- Streaming responses
- Image and document inputs
- Temperature and sampling parameters
- Stop sequences and metadata
- Tool use and function calling
- Mixed content types

## AI SDK Version Testing

The `ai-sdk.ts` test file can be run against multiple versions of the Vercel AI SDK (v3, v4, v5, and v6 beta) to ensure compatibility across versions. Each version has its own directory with compatible provider packages:

- `ai-sdk-v3/` - AI SDK v3.x with compatible providers
- `ai-sdk-v4/` - AI SDK v4.x with compatible providers
- `ai-sdk-v5/` - AI SDK v5.x with compatible providers
- `ai-sdk-v6/` - AI SDK v6.x beta with compatible providers

Additionally, OTEL (OpenTelemetry) tests are available for certain versions. OTEL test directories and files end with `-otel`:

- `ai-sdk-v5-otel/` - AI SDK v5.x with OTEL integration
- `ai-sdk-v6-otel/` - AI SDK v6.x with OTEL integration

### Running AI SDK Version Tests

```bash
# Install dependencies for a specific version
cd ai-sdk-v5
pnpm install --ignore-workspace

# Run the tests
npx tsx ai-sdk.ts

# Or test another version
cd ../ai-sdk-v3
pnpm install --ignore-workspace
npx tsx ai-sdk.ts
```

### Running OTEL Tests

OTEL tests validate OpenTelemetry integration with the AI SDK. These tests use folders and test files ending with `-otel` (e.g., `ai-sdk-v5-otel/` and `ai-sdk-otel.ts`).

```bash
# Install dependencies for a specific OTEL version
cd ai-sdk-v5-otel
pnpm install --ignore-workspace

# Set required environment variables
export OTEL_EXPORTER_OTLP_ENDPOINT=<your-otlp-endpoint>
export BRAINTRUST_PARENT=project_name:golden-ts-ai-sdk-v5-otel
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <secret>, x-bt-parent=project_name:golden-ts-ai-sdk-v5-otel"

# Also set the AI provider keys (e.g., OPENAI_API_KEY, ANTHROPIC_API_KEY)

# Run the OTEL tests
npx tsx ai-sdk-otel.ts
```

**Note**: Replace `<version>` in the environment variables with the actual version number (e.g., `v5`, `v6`). For example, for `ai-sdk-v6-otel`, use `golden-ts-ai-sdk-v6-otel`.

### Updating Test Files

When you update the main `ai-sdk.ts` file, sync it to all version directories:

```bash
./sync-test-file.sh
```

Or manually:

```bash
for dir in ai-sdk-v{3,4,5,6}; do
  cp ai-sdk.ts $dir/ai-sdk.ts
done
```

## Running Tests

### TypeScript Tests

```bash
pnpm dlx tsx anthropic.ts
pnpm dlx tsx openai.ts
```

### Vitest Golden Tests

```bash
cd vitest
pnpm install --ignore-workspace
export BRAINTRUST_API_KEY=<your-key>  # Required to send spans to Braintrust
export OPENAI_API_KEY=<your-key>       # Required for OpenAI tests
pnpm test
```

This will run the Vitest wrapper golden tests which validate that the `wrapVitest` integration correctly traces test execution to Braintrust. Tests include both basic logging and OpenAI API calls to verify wrapper composition.

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

### OTEL Test Requirements

For OTEL tests (folders and files ending with `-otel`), you need additional environment variables:

- `OTEL_EXPORTER_OTLP_ENDPOINT` - The OTLP endpoint URL
- `BRAINTRUST_PARENT` - Set to `project_name:golden-ts-ai-sdk-<version>-otel` (replace `<version>` with the actual version, e.g., `v5` or `v6`)
- `OTEL_EXPORTER_OTLP_HEADERS` - Set to `"Authorization=Bearer <secret>, x-bt-parent=project_name:golden-ts-ai-sdk-<version>-otel"` (replace `<secret>` with your Braintrust API key and `<version>` with the actual version)

In addition to these OTEL-specific variables, you still need to set the AI provider keys (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) as required by the test.

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
