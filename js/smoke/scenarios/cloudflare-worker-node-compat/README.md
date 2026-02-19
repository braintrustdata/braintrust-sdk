# Cloudflare Worker Node Compat Scenario

Tests Braintrust SDK in Cloudflare Workers with `braintrust` (Node.js) entrypoint and `nodejs_compat_v2` enabled.

## Design Decisions

### Import Path

Uses `braintrust` (Node.js entrypoint) to test Node.js-compatible APIs in Cloudflare Workers environment.

### Compatibility Flags

`nodejs_compat_v2` is enabled to provide Node.js API compatibility in the Cloudflare Workers runtime. This allows the Node.js entrypoint to access required Node.js APIs like `crypto`, `buffer`, etc.

### Expected Outcome

All tests should pass. The Node.js entrypoint requires `nodejs_compat_v2` to function properly in Cloudflare Workers.

### Test Pattern

- Spawns wrangler dev server
- Makes HTTP request to worker
- Runs shared test suite inside worker runtime
- No mocks - real Cloudflare Workers environment with Node.js compatibility layer
