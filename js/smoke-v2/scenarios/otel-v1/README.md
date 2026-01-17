# OTEL v1 Scenario

Tests Braintrust SDK with OpenTelemetry v1 NodeSDK integration.

## What This Tests

- **Basic span export** - Verifies BraintrustSpanProcessor exports spans to OTLP endpoint
- **AI span filtering** - Tests `filterAISpans` option correctly filters non-AI spans
- **Real integration** - Uses actual OpenTelemetry NodeSDK, not mocks

## Structure

```
otel-v1/
├── src/
│   └── test-helpers.ts    # Mock OTLP collector (shared by tests)
├── tests/
│   ├── basic.test.ts      # Basic span export
│   └── filtering.test.ts  # AI span filtering
├── Makefile               # Explicit test commands
├── package.json           # Dependencies only (no scripts)
└── mise.toml              # Node 22 environment
```

## Requirements

- Node.js 22 (managed by mise)
- OpenTelemetry v1.9.0
- @braintrust/otel package

**Note**: Currently has peer dependency conflicts that need fixing in source packages.

## Running Locally

```bash
# From smoke-v2/ root
make test otel-v1    # Run this scenario (builds SDK if needed)
make test            # Run all scenarios

# Or from scenarios/otel-v1/ directory
make test            # Runs setup + all tests
```

## Running in CI

CI builds SDK, uploads tarball, downloads in job, runs `make test`.

## Adding New Tests

1. Create `tests/your-test.test.ts` with realistic code (no mocks)
2. Add explicit command to Makefile `test` target: `npx tsx tests/your-test.test.ts`
3. Write like a user would - use real SDK, real APIs, real servers
4. Reuse `src/test-helpers.ts` for common setup (e.g., mock OTLP collector)

## Test Approach

All tests use realistic integration testing:

- **Real OpenTelemetry SDK** with BraintrustSpanProcessor
- **Real HTTP server** (`src/test-helpers.ts`) to capture OTLP exports
- **No test frameworks** - just Node.js built-ins (http, assert)
- **Tests exactly how users would integrate** OTEL with Braintrust

### Test Helper Pattern

Each test:

1. Calls `setupMockOtlpCollector()` to get a collector URL and payloads array
2. Sets `BRAINTRUST_API_URL` to the collector URL
3. Runs OTEL SDK with BraintrustSpanProcessor
4. Asserts on captured payloads
5. Cleans up collector

This eliminates duplication while keeping tests realistic.
