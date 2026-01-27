# OTEL v1 Scenario

Tests OpenTelemetry v1 integration with Braintrust SDK.

## Design Decisions

### Tarball Installation

Uses `file:` dependencies pointing to pre-built tarballs instead of workspace linking:

- `"braintrust": "file:../../../artifacts/braintrust-latest.tgz"`
- `"@braintrust/otel": "file:../../../artifacts/braintrust-otel-latest.tgz"`
- Makefile builds both packages and creates tarballs in `artifacts/` directory
- More realistic test of published package structure

### Multiple Package Build

Requires building two separate packages:

1. Main SDK: `cd ../../.. && pnpm build && npm pack`
2. OTEL integration: `cd ../../../../integrations/otel-js && pnpm build && pnpm pack`

- Both tarballs copied to `artifacts/` with stable names (`-latest.tgz`)
- Ensures we test the OTEL integration package, not just the main SDK

### Test Helper Pattern

Uses shared mock OTLP collector (`src/test-helpers.ts`) across all tests:

- Eliminates duplication while keeping tests realistic
- Real HTTP server captures OTLP exports for assertions
- No test frameworks - just Node.js built-ins (http, assert)
