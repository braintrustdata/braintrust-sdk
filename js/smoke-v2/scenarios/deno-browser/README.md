# Deno Browser Build Test

This scenario tests the browser-specific build (`braintrust/browser` package) running in Deno.

## What This Tests

- Browser SDK build works in Deno runtime
- All exports are accessible via npm: specifier with /browser subpath
- Shared test suites pass (import verification, basic logging, evals, prompts)
- Template rendering works with mustache (nunjucks not supported in browser build)

## Dependencies

The browser build requires these npm packages (installed via Deno's npm: specifier):

- `uuid` - UUID generation for spans and traces
- `zod` (v3 and v4) - Schema validation
- `@std/assert` - Deno standard library assertions

## Running Tests

```bash
# From smoke-v2/ directory
make test deno-browser

# Or directly in this directory
make test
```

## Test Files

- `tests/shared-suite.test.ts` - Runs shared test suites from smoke-v2/shared

## Differences from Node Build

Unlike the Node.js build (`deno-node`), this build:

- Only supports mustache template engine (nunjucks throws error)
- Does not include Node.js-specific dependencies (nunjucks, simple-git)
- Uses the `braintrust/browser` export instead of main `braintrust` export
- Browser-optimized bundle with platform-specific implementations

## Browser Build Features

The browser build (`braintrust/browser`) is configured with:

- `platform: "browser"` in tsup config
- Browser-specific `.browser.ts` file variants
- External dependencies marked but still importable (uuid, zod, mustache)
- No nunjucks support (stub implementations that throw errors)
