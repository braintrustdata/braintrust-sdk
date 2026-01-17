# Next.js Instrumentation Scenario

Tests Braintrust SDK with @braintrust/otel in Next.js application across multiple runtimes.

## What This Tests

### Build-Time Tests

- Webpack bundling and import resolution
- Static analysis of imports (catches missing exports)
- ESM/CJS interoperability in Next.js environment
- Tree-shaking issues with the shared test package

### Runtime Tests

**Edge Runtime** (`/api/smoke-test/edge`):

- Runs in V8 isolates (same as Cloudflare Workers)
- No filesystem, no Node.js APIs
- Tests: 16+ (13 import verification + 3 functional)

**Node.js Runtime** (`/api/smoke-test/node`):

- Full Node.js environment
- Standard Next.js API route runtime
- Tests: 16+ (13 import verification + 3 functional)

## Requirements

- Node.js 22 (managed by mise)
- Next.js 14.2.x
- @braintrust/otel package

## Running Locally

```bash
# From smoke-v2/ root
make test nextjs-instrumentation    # Run this scenario

# Or from scenarios/nextjs-instrumentation/ directory
make test                           # Runs both build and runtime tests
make test:build                     # Build-time test only
make test:runtime                   # Runtime tests only (Edge + Node.js)
```

**Note**: All test execution happens via Makefile commands, not npm scripts.

## Test Approach

### Build-Time Test (`make test:build`)

Runs `npx next build` to verify webpack can bundle SDK correctly. This catches:

- Export issues that runtime tests might miss
- ESM/CJS interoperability problems
- Tree-shaking issues

### Runtime Tests (`make test:runtime`)

Starts Next.js dev server, hits API endpoints, verifies tests run in both runtimes:

- **Edge Runtime** - V8 isolates (like Cloudflare Workers), no Node.js APIs
- **Node.js Runtime** - Full Node.js environment

All tests are realistic:

- Real Next.js dev server (not build preview)
- Real API routes in both runtimes
- Real SDK integration
- No mocks - tests exactly how users would integrate

### Why Both Build and Runtime?

Build-time catches **static issues** (imports, exports, bundling).
Runtime catches **execution issues** (actually running the code in different environments).

Both are needed for comprehensive Next.js testing.
