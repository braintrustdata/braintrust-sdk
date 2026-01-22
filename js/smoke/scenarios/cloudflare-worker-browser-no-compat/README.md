# Cloudflare Worker Browser No Compat Scenario

Tests Braintrust SDK in Cloudflare Workers with `braintrust/browser` entrypoint without Node.js compatibility flags.

## Design Decisions

### Import Path

Uses `braintrust/browser` (browser entrypoint) to test the most lightweight configuration. The browser entrypoint is designed to work in environments without Node.js APIs.

### Compatibility Flags

No compatibility flags are enabled. This tests the pure Cloudflare Workers runtime without Node.js polyfills, representing the most minimal configuration.

### Expected Outcome

All tests should pass. The browser entrypoint is designed to work in standard Web API environments without requiring Node.js compatibility.

### Test Pattern

- Spawns wrangler dev server
- Makes HTTP request to worker
- Runs shared test suite inside worker runtime
- No mocks - real Cloudflare Workers environment without Node.js compatibility layer
- Most lightweight configuration - ideal for production use cases
