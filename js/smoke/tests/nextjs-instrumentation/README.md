# Next.js Instrumentation Smoke Test

This smoke test verifies that `braintrust` and `@braintrust/otel` work correctly
in a Next.js application using the instrumentation hook with `@vercel/otel`.

## What This Tests

Next.js performs static analysis of imports during the build process. This can
catch export issues that runtime-only tests miss. Specifically, this test catches:

- Missing exports from `braintrust` that `@braintrust/otel` depends on
- Module resolution issues in webpack/turbopack bundling
- ESM/CJS interoperability problems in the Next.js environment

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

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps

# Run the test (performs next build)
npm test
```

For CI with local build artifacts:

```bash
npm run install-build
npm test
```

## Test Structure

- `instrumentation.ts` - Next.js instrumentation file that imports `@braintrust/otel`
- `app/` - Minimal Next.js app router setup (required for build to run)
- `next.config.mjs` - Enables the experimental instrumentation hook

## Success Criteria

The test passes if `next build` completes without import/export errors.
Warnings about optional dependencies (like `@opentelemetry/exporter-jaeger`) are acceptable.
