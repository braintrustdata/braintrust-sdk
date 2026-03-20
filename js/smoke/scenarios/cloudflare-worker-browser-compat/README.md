# Cloudflare Worker Browser Compat Scenario

Tests Braintrust SDK in Cloudflare Workers with the top-level `braintrust` import resolving to the `workerd` build, with `nodejs_compat_v2` enabled.

## Design Decisions

### Import Path

Uses `braintrust` and asserts that Cloudflare resolves it to the `workerd` build in this runtime.

### Compatibility Flags

`nodejs_compat_v2` is enabled to verify that the default Cloudflare Workers resolution still behaves correctly when Node.js compatibility is present.

### Expected Outcome

All tests should pass. The package should resolve to the `workerd` build and ALS-backed parent propagation should work with Node.js compatibility enabled.

### Test Pattern

- Spawns wrangler dev server
- Makes HTTP request to worker
- Runs shared test suite inside worker runtime
- No mocks - real Cloudflare Workers environment with Node.js compatibility layer
- Tests that the default Worker import path resolves to the `workerd` build under `nodejs_compat_v2`
