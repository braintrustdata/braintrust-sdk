# Eval Bun Scenario

Tests that `braintrust eval` works with Bun runtime and package manager.

## What This Tests

- Bun's fast package manager (`bun install`)
- Running CLI via `bun run braintrust eval`
- Bun-specific APIs (`Bun.file()`, `Bun.write()`)
- Bun-specific imports (`bun:sqlite`, `bun` module)
- Top-level await support
- ESM support in Bun environment

## Design Decisions

**Why Bun?** Bun is a fast JavaScript runtime that many users prefer for speed. Tests ensure CLI works correctly with Bun's module resolution and runtime.

**Why these tests?** Tests Bun-specific features that users would want to use in their evals:

- `Bun.file()` / `Bun.write()` - Fast file I/O unique to Bun
- `bun:sqlite` - Built-in SQLite without external dependencies
- `bun` module - Runtime information and APIs
- Top-level await - ESM feature that Bun supports natively

## Requirements

- `mise` must be installed for runtime management

Bun will be automatically installed via `mise` using the version specified in `.tool-versions`.

## Test Files

1. **`basic.eval.ts`** - Basic eval with Bun runtime
2. **`top-level-await.eval.ts`** - Top-level await (ESM feature)
3. **`bun-file-api.eval.ts`** - Bun's file API (`Bun.file()`, `Bun.write()`)
4. **`bun-imports.eval.ts`** - Bun-specific imports (`bun:sqlite`, `bun` module)

## Expected Behavior

All tests should pass using Bun's runtime. Bun-specific APIs (`Bun.*` and `bun:*` imports) will not work in Node.js - they're unique to Bun.

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make test
```
