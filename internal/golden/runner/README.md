# Golden Test Runner

A test runner for normalizing and comparing LLM spans from various SDK integrations.

## Features

- Runs test cases from multiple TypeScript files
- Normalizes spans using standard converters and Lingua converter
- Saves normalized results to the filesystem for comparison
- Supports filtering by file glob patterns and test name patterns
- Generates structured output for easy analysis
- Test files can be run individually for direct Braintrust logging

## Running Tests

### Using the Test Runner

The test runner processes multiple test files and normalizes their outputs:

```bash
# Run all tests using pnpm script
pnpm test

# Run with options
pnpm test -- --glob "langchain.ts" --filter "testAsync.*"

# Run directly with pnpm dlx
pnpm dlx tsx runner/cli.ts [options]
```

### Running Individual Test Files

Each golden test file can also be run independently to log spans directly to Braintrust:

```bash
# Run a single test file
pnpm dlx tsx langchain.ts

# Run a test file in a subdirectory
pnpm dlx tsx otel/ai-sdk.ts

# With environment variables
BRAINTRUST_APP_URL=http://localhost:3000 pnpm dlx tsx openai.ts
```

When run individually, test files:

- Execute all test functions that start with "test"
- Log spans directly to the configured Braintrust project
- Use the project configuration from the setup function
- Are useful for debugging specific integrations

## Runner Options

- `-g, --glob <pattern>` - File glob pattern for test files (default: "\*_/_.ts")
- `-f, --filter <regex>` - Regular expression to filter test cases by name
- `-o, --output <mode>` - Output mode: "files" or "print" (default: "files")
- `-h, --help` - Show help message

### Examples

Run all tests in all TypeScript files:

```bash
pnpm test
```

Run only langchain tests:

```bash
pnpm test -- --glob "langchain.ts"
```

Run tests in a subdirectory:

```bash
pnpm test -- --glob "otel/*.ts"
```

Run only async tests:

```bash
pnpm test -- --filter "test.*async"
```

Combine file and test filtering:

```bash
pnpm test -- --glob "langchain.ts" --filter "testAsync.*"
```

Output results as JSON to stdout (for copying/piping):

```bash
# Copy all results to clipboard (macOS)
pnpm test -- --output print | pbcopy

# Copy filtered results to clipboard
pnpm test -- --glob "langchain.ts" --output print | pbcopy

# Save results to a file
pnpm test -- --output print > results.json

# Process results with jq
pnpm test -- --output print | jq '.[].testName'
```

## Output Modes

### Files Mode (default)

In files mode (`--output files`), the runner:

- Displays progress and statistics to stderr
- Saves results as individual JSON files in the filesystem
- Shows a detailed summary after completion

### Print Mode

In print mode (`--output print`), the runner:

- Outputs only valid JSON to stdout
- Sends all informational messages to stderr
- Returns an array of all test results
- Perfect for piping to other tools or copying to clipboard

The print mode output is a JSON array where each element contains:

```json
{
  "testFile": "langchain.ts",
  "testName": "testAsyncGeneration",
  "spans": [...],
  "normalized": {...},
  "lingua": {...}
}
```

## Output Structure

When using files mode, results are saved to the filesystem with the following structure:

```
sdk/internal/golden/
├── langchain.ts
├── langchain-ts/           # Output directory for langchain.ts
│   ├── test-async-generation.json
│   ├── test-sync-generation.json
│   └── ...
├── openai.ts
├── openai-ts/              # Output directory for openai.ts
│   ├── test-streaming.json
│   └── ...
└── otel/
    ├── ai-sdk.ts
    └── ai-sdk-ts/          # Output directory for otel/ai-sdk.ts
        └── test-example.json
```

Each JSON file contains:

- `testFile` - The source test file
- `testName` - The name of the test case
- `spans` - Raw span data from the test
- `normalized` - Result from standard normalizers
- `lingua` - Result from Lingua converter only

## Normalizer Modes

The runner tests each span with two modes:

1. **Standard Mode** (`useLingua: false`)

   - Uses all available normalizers (LangChain, OpenAI, AI SDK, etc.)
   - Auto-detects the appropriate normalizer based on span format

2. **Lingua Mode** (`useLingua: true`)
   - Uses only the Lingua converter
   - Explicit mode - if Lingua can't detect the format, the span remains unnormalized

## Summary Output

After running, the runner displays:

- Total test files processed
- Total test examples run
- Results grouped by file
- Normalization success rates for each mode
- Converter usage statistics

## Writing Test Files

Test files should export functions that start with "test" and return a Promise<Span>:

```typescript
import { traced } from "braintrust";

export async function testExample() {
  return traced(async (span) => {
    // Your test implementation
    return span;
  });
}

// Optional setup function
export function setup(logger) {
  // Initialize your test environment
  // Configure Braintrust project settings
}
```

Test files can be:

- Run individually to log directly to Braintrust
- Processed by the runner for normalization testing
- Located in any subdirectory under `sdk/internal/golden/`

## API Endpoint

The runner uses the normalize API endpoint at `/app/api/trace/normalize` which accepts:

```typescript
{
  spans: SpanData[],
  options?: {
    useLingua?: boolean  // Force Lingua-only mode
  }
}
```

Returns:

```typescript
{
  spans: NormalizedSpan[],
  converters: Record<string, string>  // span_id -> converter name
}
```

## Environment Variables

- `BRAINTRUST_APP_URL` - URL of the Braintrust API (default: `http://localhost:3000`)
- `BRAINTRUST_API_KEY` - API key for authentication (when running individual files)

## Development

The runner is organized into modular components:

- `cli.ts` - Command-line interface and argument parsing
- `runner.ts` - Core test execution logic
- `normalize.ts` - API normalization functions
- `constants.ts` - Shared configuration values
- `utils.ts` - Utility functions
- `attempt.ts` - Error handling utilities

To modify the runner, edit the appropriate module and run ESLint to ensure code quality:

```bash
npx eslint internal/golden/runner/*.ts --max-warnings=0
```
