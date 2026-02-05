# Eval ESM Scenario

Tests the `braintrust eval` CLI with **pure JavaScript ESM** files (no TypeScript).

## What This Tests

Pure ESM patterns that users write:

- **`import` syntax**: ESM imports (`import { Eval } from "braintrust"`)
- **Top-level `await`**: ESM-only async module evaluation
- **`import.meta.url`**: ESM-only module metadata
- **`.mjs` extension**: Explicit ESM file extension

## Test Files

1. **`basic.eval.mjs`** - ESM `import` syntax with `"type": "module"`
2. **`top-level-await.eval.mjs`** - Top-level `await` (ESM-only feature)
3. **`import-meta.eval.mjs`** - `import.meta.url` (ESM-only global)

## Key Differences from TypeScript Scenarios

- Pure JavaScript - No TypeScript compilation
- `import` syntax - ESM imports (not `require()`)
- No tsconfig.json - Not a TypeScript project
- `.mjs` extension - Explicit ESM files

## Related Scenarios

- **`eval-ts-esm`**: TypeScript files configured for ESM output
- **`eval-cjs`**: Pure JavaScript CommonJS files

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make test eval-esm
```
