# Eval Deno Scenario

Tests Braintrust SDK usage in **Deno runtime using `npm:` import specifiers**.

## What This Tests

- **`npm:braintrust` imports** - Deno's npm package compatibility layer
- **Deno-specific APIs**: `Deno.env`, `Deno.readTextFile()`, `Deno.writeTextFile()`, etc.
- **Top-level await** - Native Deno support
- **`Eval()` API** - Direct SDK usage in Deno runtime

## Command Pattern

```bash
deno run --allow-env --allow-read --allow-write --allow-net --allow-run file.eval.ts
```

This tests how Deno users would import and use the Braintrust SDK in their code using `npm:` specifiers.

## Test Files

1. **`basic.eval.ts`** - Basic eval with `npm:braintrust` import
2. **`top-level-await.eval.ts`** - Top-level await (native Deno feature)
3. **`deno-apis.eval.ts`** - Deno-specific APIs (`Deno.env`, `Deno.readTextFile()`, etc.)

## Design Decisions

**Why `npm:` imports?** Deno can use npm packages directly via `npm:` specifiers without a build step. The tarball is extracted into `node_modules/` for the `npm:braintrust` import to resolve.

**Why Deno APIs?** Tests that users can use Deno-specific features alongside Braintrust SDK.

**Why these permissions?** Deno requires explicit permissions:

- `--allow-env` - Access environment variables (for API key)
- `--allow-read` - Read files
- `--allow-write` - Write files (for temp files in tests)
- `--allow-net` - Network access (for API calls)
- `--allow-run` - Run subprocesses (SDK may spawn processes)

## Related Scenarios

- **`eval-deno-npm`**: Node.js CLI handling Deno-style TypeScript files
- **`framework-tests/deno`**: More comprehensive Deno SDK testing

## Expected Behavior

All tests should pass. Deno natively supports:

- ✅ Top-level await
- ✅ ESM imports
- ✅ npm packages via `npm:` specifier
- ✅ Deno-specific APIs
- ✅ TypeScript without compilation

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make eval-deno
```
