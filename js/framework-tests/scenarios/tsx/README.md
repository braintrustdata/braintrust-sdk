# tsx Framework Scenario

Tests running `Eval()` directly via tsx execution.

## What This Tests

- Direct execution of eval files with tsx
- Fast TypeScript execution without compilation
- ESM and top-level await support
- Running evals without the CLI

## Use Case

tsx (TypeScript Execute) is a popular tool for running TypeScript files directly without a build step. It's fast, simple, and widely used in the Node.js ecosystem. Users want to:

- Run eval files directly without compilation
- Use tsx in their development workflow
- Have full ESM support including top-level await

## Design Decisions

**Why tsx?** tsx is a modern, fast alternative to ts-node that's gained significant adoption. It uses esbuild for transformation and supports all modern TypeScript/ESM features.

**Why mock server?** Tests send logs to a mock API server (localhost:8001) to ensure realistic behavior without hitting production.

**Why not use CLI?** Users may prefer tsx for its speed and simplicity, especially during development.

## Expected Behavior

All eval files should execute successfully with full ESM and TypeScript support.

## Running

```bash
# From this directory:
make test

# From framework-tests root:
make test
```
