# Eval Deno NPM Scenario

Tests what happens when someone writes Deno-style TypeScript files and tries to run them with the `braintrust eval` CLI.

## What This Tests

- CLI handling of Deno-style TypeScript files
- Top-level await in Deno-targeted code
- Whether esbuild can bundle Deno-compatible TypeScript
- User expectations vs CLI reality

## User Scenario

A developer writes TypeScript files targeting Deno runtime, then tries:

```bash
npx braintrust eval my-deno-file.ts
```

They expect it to work since it's "just TypeScript", but may encounter issues depending on:

- Whether they use Deno-specific APIs (like `Deno.env.get()`)
- Whether they use ESM features the CLI's esbuild setup supports
- Module resolution differences between Deno and Node.js

## Design Decisions

**Why test Deno files with CLI?** Users may not realize the CLI is a Node.js binary and may try to use it with Deno-targeted files. This tests that scenario.

**Why not use Deno APIs?** We test "Deno-style" TypeScript (ESM, top-level await) without Deno-specific APIs to see if the CLI can at least handle Deno-compatible TypeScript. If users need Deno APIs, they should use the Deno runtime directly (see `framework-tests/deno`).

**What's expected to happen?**

- Basic ESM files should work (CLI uses esbuild which supports ESM)
- Top-level await may or may not work depending on CLI's compilation settings
- Deno-specific APIs (if used) would fail since the CLI runs in Node.js

## Related Scenarios

- **`cli-tests/eval-deno`**: Deno runtime (`deno run npm:braintrust eval`) with Deno APIs
- **`cli-tests/eval-esm`**: npm CLI with pure JavaScript ESM modules in Node.js
- **`cli-tests/eval-ts-esm`**: npm CLI with TypeScript ESM modules in Node.js
- **`cli-tests/eval-bun-npm`**: npm CLI with Bun-style TypeScript
- **`framework-tests/deno`**: `Eval()` API directly in Deno runtime

## Comparison with eval-deno

| Scenario        | Runtime | Code Style              | Command                        |
| --------------- | ------- | ----------------------- | ------------------------------ |
| `eval-deno`     | Deno    | Deno/ESM + Deno APIs    | `deno run npm:braintrust eval` |
| `eval-deno-npm` | Node.js | Deno/ESM (no Deno APIs) | `npm run braintrust eval`      |

The key difference: `eval-deno` uses Deno runtime and can use Deno-specific APIs, while `eval-deno-npm` uses Node.js CLI on Deno-style code (no Deno APIs).

## Expected Behavior

This documents real-world behavior. If tests fail, it shows what happens when users try to use the CLI with Deno-targeted files.

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make test
```
