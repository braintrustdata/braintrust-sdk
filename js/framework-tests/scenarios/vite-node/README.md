# vite-node Framework Scenario

Tests running `Eval()` directly via vite-node execution (customer workaround).

## What This Tests

- Direct execution of eval files with vite-node
- ESM and TypeScript transformation via Vite
- Top-level await support
- Running evals without the CLI

## Customer Use Case

Customer feedback: _"The lack of ESM bundling support in the eval runtime has forced us to use the eval framework via vite-node."_

This scenario tests the customer's actual workaround: running eval files directly with `vite-node` instead of using the `braintrust eval` CLI. Users chose this approach because:

- Better ESM support than CLI's esbuild approach
- Native TypeScript transformation
- Supports all ESM features (top-level await, dynamic imports, etc.)

## Design Decisions

**Why vite-node?** This is what the customer explicitly mentioned using. It's Vite's on-demand file transformation, providing fast TypeScript and ESM execution.

**Why mock server?** Tests send logs to a mock API server (localhost:8001) to ensure realistic behavior without hitting production.

**Why not use CLI?** This scenario specifically tests the workaround users adopted when the CLI didn't meet their ESM needs.

## Expected Behavior

All eval files should execute successfully with full ESM support.

## Running

```bash
# From this directory:
make test

# From framework-tests root:
make test
```
