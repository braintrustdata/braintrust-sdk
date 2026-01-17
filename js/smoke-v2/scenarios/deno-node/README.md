# Deno Node Build Test

This scenario tests the main Node.js-compatible build (`braintrust` package) running in Deno.

## What This Tests

- Main SDK build works in Deno runtime
- All exports are accessible via npm: specifier
- Shared test suites pass (import verification, basic logging, evals, prompts)
- Legacy span tests pass (basic span creation, template rendering)
- Both mustache and nunjucks template engines work

## Dependencies

The Node.js build requires these npm packages (installed via Deno's npm: specifier):

- `uuid` - UUID generation for spans and traces
- `zod` (v3 and v4) - Schema validation
- `nunjucks` - Template rendering (Nunjucks format)
- `simple-git` - Git operations
- `@std/assert` - Deno standard library assertions

## Running Tests

```bash
# From smoke-v2/ directory
make test deno-node

# Or directly in this directory
make test
```

## Test Files

- `tests/shared-suite.test.ts` - Runs shared test suites from smoke-v2/shared (covers import verification, basic logging, evals, and prompt templating including both mustache and nunjucks)

## Differences from Browser Build

Unlike the browser build (`deno-browser`), this build:

- Supports both mustache and nunjucks template engines
- Includes Node.js-specific dependencies (simple-git)
- Uses the main `braintrust` export (not `braintrust/browser`)
