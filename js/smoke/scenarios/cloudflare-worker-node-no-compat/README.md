# Cloudflare Worker Node No Compat Scenario

Tests Braintrust SDK in Cloudflare Workers with `braintrust` (Node.js) entrypoint without Node.js compatibility flags.

## Design Decisions

### Import Path

Uses `braintrust` (Node.js entrypoint) which requires Node.js APIs.

### Compatibility Flags

No compatibility flags are enabled. This intentionally creates an invalid configuration to document the expected failure.

### Expected Outcome

**This scenario is expected to FAIL at startup.** The Node.js entrypoint requires `nodejs_compat_v2` to function in Cloudflare Workers because it relies on Node.js-specific APIs like `crypto`, `buffer`, and others that are not available in the standard Cloudflare Workers runtime.

The test passes if wrangler fails to start the worker, documenting that this configuration is not supported.

### Test Pattern

- Spawns wrangler dev server
- Expects startup to fail
- Test passes if server fails to start
- Documents that Node.js entrypoint requires nodejs_compat_v2
