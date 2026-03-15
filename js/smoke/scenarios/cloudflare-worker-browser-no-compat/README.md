# Cloudflare Worker Browser No Compat Scenario

Tests Braintrust SDK in Cloudflare Workers with the top-level `braintrust` import resolving to the `workerd` build, without Node.js compatibility flags.

## Design Decisions

### Import Path

Uses `braintrust` and asserts that Cloudflare resolves it to the `workerd` build in the most lightweight Worker configuration.

### Compatibility Flags

No compatibility flags are enabled. This tests the pure Cloudflare Workers runtime without Node.js polyfills, representing the most minimal configuration.

### Expected Outcome

The scenario should pass with its documented expected failures. The package should still resolve to the `workerd` build in a pure Workers runtime, while ALS-specific parent propagation remains an expected failure without Node.js compatibility.

### Test Pattern

- Spawns wrangler dev server
- Makes HTTP request to worker
- Runs shared test suite inside worker runtime
- No mocks - real Cloudflare Workers environment without Node.js compatibility layer
- Most lightweight configuration - ideal for production use cases
