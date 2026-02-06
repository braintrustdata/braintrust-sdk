# Deno Framework Scenario

Tests that `Eval()` works with Deno runtime by running evals directly.

## What This Tests

- Deno's security model (permissions: --allow-env, --allow-read, --allow-net)
- Import mapping via deno.json
- Running evals with Deno's runtime
- ESM-only environment

## Use Case

Users writing Deno applications want to use Braintrust evals without switching to Node.js. This tests that the SDK works correctly in Deno's runtime environment.

## Design Decisions

**Why npm: imports with nodeModulesDir?** Following Deno best practices, we use `npm:` imports with `nodeModulesDir: "auto"`. We install the tarball using npm first to populate node_modules, then Deno imports from there using its npm compatibility layer.

**Why not use CLI?** The `braintrust eval` CLI is a Node.js binary and can't be executed directly by Deno. Users in Deno environments would call `Eval()` directly in their code.

**Why these permissions?** Evals need:

- `--allow-env`: Read environment variables
- `--allow-read`: Read eval files
- `--allow-net`: Send data to Braintrust API

## Requirements

- `mise` must be installed for runtime management

Deno will be automatically installed via `mise` using the version specified in `.tool-versions`.

## Expected Behavior

Should run evals using Deno's runtime with proper permissions.

## Running

```bash
# From this directory:
make test

# From cli-tests root:
make test
```
