# Cloudflare Worker Browser Compat Scenario

Tests Braintrust SDK in Cloudflare Workers with `braintrust/browser` entrypoint with `nodejs_compat_v2` enabled.

## Design Decisions

### Import Path

Uses `braintrust/browser` (browser entrypoint) to test browser-compatible code with Node.js APIs available.

### Compatibility Flags

`nodejs_compat_v2` is enabled. While the browser entrypoint doesn't require Node.js APIs, this tests that the browser entrypoint works correctly when Node.js compatibility is present. This is useful for scenarios where other parts of the application need Node.js APIs.

### Expected Outcome

All tests should pass. The browser entrypoint should work correctly regardless of whether Node.js compatibility is enabled or not.

### Test Pattern

- Spawns wrangler dev server
- Makes HTTP request to worker
- Runs shared test suite inside worker runtime
- No mocks - real Cloudflare Workers environment with Node.js compatibility layer
- Tests that browser entrypoint is compatible with nodejs_compat_v2 flag
