# Eval TypeScript CJS Scenario

Tests the `braintrust eval` CLI with **TypeScript files configured for CommonJS output**.

## What This Tests

TypeScript → CJS bundling concerns:

- **TypeScript compilation**: esbuild compiling `.ts` to CJS
- **Type checking**: TypeScript types with CJS module system
- **Dynamic imports**: `await import()` in async functions
- **Module resolution**: Node-style resolution with TypeScript

## Test Files

1. **`basic.eval.ts`** - Basic TypeScript with CJS tsconfig
2. **`async-import.eval.ts`** - Dynamic `import()` in async functions

## TypeScript Configuration

```json
{
  "module": "commonjs",
  "moduleResolution": "node"
}
```

## Key Differences

- **vs eval-cjs**: TypeScript (not pure JS), uses `import` syntax
- **vs eval-ts-esm**: CJS output (not ESM), no top-level await

## Expected Behavior

The CLI should:

- ✅ Compile TypeScript to CJS
- ✅ Handle dynamic imports in async functions
- ✅ Preserve CJS module semantics
- ❌ Fail on top-level await (not CJS-compatible)

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make test
```
