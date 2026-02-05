# Eval TypeScript ESM Scenario

Tests that `braintrust eval` works with **TypeScript files configured for ESM output**.

## What This Tests

- ESM import/export syntax (`import { Eval } from "braintrust"`)
- Top-level `await` (ESM async module evaluation)
- CLI can execute `.eval.ts` files with `"type": "module"`
- TypeScript configured for ESM output (`"module": "ESNext"`, `"moduleResolution": "bundler"`)

## Key Differences

- **vs eval-esm**: TypeScript (not pure JS), uses `.ts` files with tsconfig
- **vs eval-ts-cjs**: ESM output (not CJS), supports top-level await

## Expected Behavior

**Current CLI (esbuild + new Function):**

- `basic.eval.ts`: Works (ESM imports compile to CJS)
- `top-level-await.eval.ts`: Compilation error but exits 0

**After ESM support (tsx or dynamic import):**
Both tests should pass and execute successfully.

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make test eval-ts-esm
```
