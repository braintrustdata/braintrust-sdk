# Eval ESM Scenario

Tests that `braintrust eval` works with ESM modules and top-level await.

## What This Tests

- ESM import/export syntax (`import { Eval } from "braintrust"`)
- Top-level `await` (ESM async module evaluation)
- CLI can execute `.eval.ts` files with `"type": "module"`

## Design Decisions

**Why ESM?** Many modern projects use ESM (`"type": "module"`), and customers report
issues when trying to use ESM with the CLI.

**Why top-level await?** It's an ESM-only feature that proves async module evaluation
works correctly. Common use case: loading config before defining evals.

**Why these specific tests?** Minimal reproducible cases that will fail with the current
CLI implementation (which uses `new Function()` with CommonJS).

## Expected Behavior

**Current CLI (esbuild + new Function):**

- `basic.eval.ts`: ✓ Works (ESM imports compile to CJS)
- `top-level-await.eval.ts`: Compilation error but exits 0

**After ESM support (tsx or dynamic import):**
Both tests should pass and execute successfully.

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make test eval-esm
```
