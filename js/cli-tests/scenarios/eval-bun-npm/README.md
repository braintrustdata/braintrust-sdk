# Eval Bun NPM Scenario

Tests what happens when someone writes Bun-style TypeScript files and tries to run them with the Node.js `braintrust eval` CLI.

## What This Tests

- CLI handling of Bun-targeted TypeScript files
- Top-level await in Bun-style code
- Whether Node.js CLI (via esbuild) can handle Bun-compatible TypeScript
- User expectations vs CLI reality

## User Scenario

A developer writes TypeScript files targeting Bun runtime, then tries:

```bash
npm run braintrust eval my-bun-file.ts
```

They expect it to work since it's "just TypeScript", but may encounter issues depending on:

- Whether they use Bun-specific APIs (like `Bun.file()`)
- Whether they use ESM features the CLI's esbuild setup supports
- TypeScript features and module resolution

## Design Decisions

**Why test Bun code with Node.js CLI?** Users may not realize the CLI is a Node.js binary and may try to use it with Bun-targeted files. This tests that scenario.

**Why not use Bun APIs?** We test "Bun-style" TypeScript (ESM, top-level await, modern features) without Bun-specific APIs to see if the Node.js CLI can at least handle Bun-compatible TypeScript. If users need Bun APIs, they should use Bun runtime directly (see `eval-bun`).

**What's expected to happen?**

- Basic ESM files should work (CLI uses esbuild which supports ESM)
- Top-level await should work (esbuild can handle it)
- Bun-specific APIs (if used) would fail since the CLI runs in Node.js

## Related Scenarios

- **`eval-bun`**: Running CLI with Bun runtime (`bun run braintrust eval`)
- **`eval-esm`**: Node.js CLI with pure JavaScript ESM modules
- **`eval-ts-esm`**: Node.js CLI with TypeScript ESM modules
- **`eval-deno-npm`**: Node.js CLI with Deno-style TypeScript

## Comparison with eval-bun

| Scenario       | Runtime | Code Style            | Command                   |
| -------------- | ------- | --------------------- | ------------------------- |
| `eval-bun`     | Bun     | Bun/ESM + Bun APIs    | `bun run braintrust eval` |
| `eval-bun-npm` | Node.js | Bun/ESM (no Bun APIs) | `npm run braintrust eval` |

The key difference: `eval-bun` uses Bun runtime and can use Bun-specific APIs, while `eval-bun-npm` uses Node.js CLI on Bun-style code (no Bun APIs).

## Expected Behavior

This documents real-world behavior. If tests pass, it shows the Node.js CLI can handle Bun-style TypeScript.

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make test
```
