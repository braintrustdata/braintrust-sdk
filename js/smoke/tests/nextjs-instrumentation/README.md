# Next.js Instrumentation Smoke Test

This smoke test verifies that `braintrust` and `@braintrust/otel` work correctly
in a Next.js application. It includes two types of tests:

1. **Build-time verification** - Tests webpack bundling and import resolution
2. **Runtime testing** - Tests actual SDK functionality in both Edge and Node.js runtimes

## What This Tests

### Build-Time Tests (`npm run build`)

Next.js performs static analysis of imports during the build process. This can
catch export issues that runtime-only tests miss. Specifically, this test catches:

- Missing exports from `braintrust` that `@braintrust/otel` depends on
- Module resolution issues in webpack/turbopack bundling
- ESM/CJS interoperability problems in the Next.js environment
- Tree-shaking issues with the shared test package

### Runtime Tests (`npm run test:shared`)

Tests the SDK in both Next.js runtime environments via API routes:

**Edge Runtime** (`/api/smoke-test/edge`):

- Runs in V8 isolates (same as Cloudflare Workers)
- No filesystem, no Node.js APIs
- Tests: 16+ (13 import verification + 3 functional)

**Node.js Runtime** (`/api/smoke-test/node`):

- Runs in full Node.js environment
- Standard Next.js API route runtime
- Tests: 16+ (13 import verification + 3 functional)

Both runtimes verify all SDK exports are available and test basic functionality.

## The Bug This Catches

This test was created to catch an issue where Next.js reported:

```
Attempted import error: 'IDGenerator' is not exported from 'braintrust' (imported as 'IDGenerator').
```

This error occurs because Next.js's webpack bundler performs static analysis of
the import/export graph, which can detect export mismatches that Node.js's runtime
resolution might not catch. The `@braintrust/otel` package imports `IDGenerator`
from `braintrust`, but Next.js's bundler cannot resolve this export.

## How to Run

### Build-Time Test (Quick)

Tests webpack bundling and import resolution:

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps

# Run build test
npm test
# or
npm run build
```

### Runtime Test (Comprehensive)

Runs the full shared test suite in both Edge and Node.js runtimes:

```bash
# Make sure shared package is built first
cd ../../shared && npm run build && cd -

# Run runtime tests (tests both Edge and Node.js runtimes)
npm run test:shared
```

This will:

1. Start the Next.js dev server
2. Wait for it to be ready
3. Call `GET /api/smoke-test/edge` endpoint (Edge Runtime)
4. Call `GET /api/smoke-test/node` endpoint (Node.js Runtime)
5. Display test results for both
6. Stop the server

For CI with local build artifacts:

```bash
npm run install-build
npm test              # Build test
npm run test:shared   # Runtime test
```

## Test Structure

- `instrumentation.ts` - Next.js instrumentation file with import verification
- `app/api/smoke-test/edge/route.ts` - Edge Runtime API route (V8 isolates)
- `app/api/smoke-test/node/route.ts` - Node.js Runtime API route
- `test-api-routes.mjs` - Test runner script (starts server, calls both endpoints)
- `app/` - Minimal Next.js app router setup
- `next.config.mjs` - Enables the experimental instrumentation hook

## Success Criteria

### Build Test

The test passes if `next build` completes without import/export errors.
Warnings about optional dependencies (like `@opentelemetry/exporter-jaeger`) are acceptable.

### Runtime Test

The test passes if:

- Dev server starts successfully
- `/api/smoke-test/edge` endpoint returns HTTP 200 with all tests passing
- `/api/smoke-test/node` endpoint returns HTTP 200 with all tests passing
- Both runtimes run 16+ tests (13 import verification + 3 functional)
- Both responses show `"success": true`

## Expected Output

### Build Test

```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Creating an optimized production build
```

### Runtime Test

```
Next.js API Routes Test
============================================================

Starting Next.js dev server...

✓ Dev server ready

✓ Server is responding

============================================================
Running Tests
============================================================

Testing Edge Runtime...
  URL: http://localhost:3000/api/smoke-test/edge
  Status: 200
  Runtime: edge
  Message: All 16 tests passed in Edge Runtime
  Tests: 16/16 passed
  Result: ✅ PASS

Testing Node.js Runtime...
  URL: http://localhost:3000/api/smoke-test/node
  Status: 200
  Runtime: nodejs
  Message: All 16 tests passed in Node.js Runtime
  Tests: 16/16 passed
  Result: ✅ PASS

============================================================
Summary
============================================================

Edge Runtime:   ✅ PASS
Node.js Runtime: ✅ PASS

✅ All tests passed!

Stopping dev server...
```
