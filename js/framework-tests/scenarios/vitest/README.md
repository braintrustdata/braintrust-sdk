# Vitest Framework Scenario

Tests running `Eval()` directly within Vitest test runner (customer use case).

## What This Tests

- Direct `Eval()` calls within Vitest tests
- Vitest's test runner and reporting
- Async eval execution
- Top-level await in test files

## Customer Use Case

Customer feedback: _"We already use Vitest for our test suite, which means our mocks and test utils are built for Vitest."_

This scenario tests that users can:

- Run evals directly in their existing Vitest test suite
- Reuse their existing test utilities and mocks
- Get Vitest's test output and reporting for evals

## Design Decisions

**Why mock server?** Tests send logs to a mock API server (localhost:8001) to ensure realistic behavior without hitting production.

**Why not use CLI?** Users want to integrate evals into their existing Vitest test suite, not run them via a separate CLI command.

## Expected Behavior

All tests should pass with Vitest's test runner output showing eval summaries.

## Running

```bash
# From this directory:
make test

# From framework-tests root:
make test
```
