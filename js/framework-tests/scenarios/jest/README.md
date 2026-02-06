# Jest Framework Scenario

Tests running `Eval()` directly within Jest test runner.

## What This Tests

- Direct `Eval()` calls within Jest tests
- Jest with ESM support (experimental)
- Async eval execution
- Top-level await in test files

## Use Case

Jest is the most popular JavaScript test framework. Many teams use Jest and want to run evals within their existing Jest test suite to reuse their mocks, utilities, and test infrastructure.

## Design Decisions

**Why Jest?** Jest is the industry standard test framework, so ensuring the SDK works in Jest is critical for adoption.

**Why ESM configuration?** Jest's ESM support is experimental but increasingly common. This tests the modern Jest setup.

**Why mock server?** Tests send logs to a mock API server (localhost:8001) to ensure realistic behavior without hitting production.

**Why node --experimental-vm-modules?** Jest's ESM support requires this flag for proper module resolution.

## Expected Behavior

All tests should pass with Jest's test runner output showing eval summaries.

## Running

```bash
# From this directory:
make test

# From framework-tests root:
make test
```
