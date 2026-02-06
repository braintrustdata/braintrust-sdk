# Braintrust Framework Tests

Test suite for using the Braintrust `Eval()` API directly across different JavaScript/TypeScript frameworks and runtimes.

## Quick Reference

```bash
# From sdk/js/framework-tests/:
make test                     # Run all scenarios
make list                     # List available scenarios
make clean                    # Clean all scenarios
cd scenarios/vitest && make test  # Run specific scenario

# From a specific scenario:
cd scenarios/vitest
make test                     # Auto-creates tarball if needed
make clean                    # Remove artifacts
```

## Purpose

This test suite verifies that the Braintrust SDK's `Eval()` API works correctly when used directly (not via CLI) in various JavaScript/TypeScript frameworks and runtimes. These tests cover the customer use cases where they:

- Want to run evals in their existing test framework (Jest, Vitest)
- Need better ESM/TypeScript support than the CLI provides (vite-node, tsx)
- Are using alternative runtimes (Deno)

## Distinction from CLI Tests

- **CLI Tests** (`sdk/js/cli-tests/`): Test the `braintrust eval` CLI command
- **Framework Tests** (this directory): Test calling `Eval()` directly in code

## Structure

Tests are organized into scenarios under `scenarios/`:

```
scenarios/
├── vitest/          # Eval() in Vitest test runner
├── jest/            # Eval() in Jest test runner
├── vite-node/       # Eval() via vite-node execution
├── tsx/             # Eval() via tsx execution
└── deno/            # Eval() in Deno runtime
```

Each scenario is an independent package that:

- Installs the built SDK tarball
- Runs framework-specific commands to execute evals
- Validates that `Eval()` works correctly with a mock API server

## Creating a New Scenario

### Requirements

- Makefile with `setup` and `test` targets
- package.json or runtime config (deno.json)
- README.md explaining the use case (15-25 lines)
- .gitignore (ignore artifacts, track lock files)
- Test files that call `Eval()` directly
- `.tool-versions` file (if scenario requires non-Node runtimes)
- POSIX shell syntax (`[ ]` not `[[ ]]`)

### Example Scenario Structure

```
scenarios/my-framework/
├── Makefile           # setup + test targets
├── package.json       # Dependencies
├── .tool-versions     # Optional: for non-Node runtimes
├── tests/
│   └── my-test.ts     # Calls Eval() directly
├── .gitignore
└── README.md
```

### Example Test File

```typescript
import { Eval } from "braintrust";

// In test framework (Jest/Vitest):
test("my eval", async () => {
  await Eval("Test Name", {
    data: () => [{ input: "test", expected: "test" }],
    task: async (input: string) => input,
    scores: [
      /* ... */
    ],
  });
});

// Or standalone (vite-node/tsx/deno):
Eval("Test Name", {
  data: () => [{ input: "test", expected: "test" }],
  task: async (input: string) => input,
  scores: [
    /* ... */
  ],
});
```

## Design Principles

- **Direct Eval() calls**: All tests call `Eval()` directly, not via CLI
- **Mock API server**: Tests send logs to a mock server on localhost:8001
- **Framework-native execution**: Use the framework's natural command (jest, vitest, vite-node, tsx, deno)
- **Well-known tarball paths**: Use `braintrust-latest.tgz` not version-specific paths
- **No workarounds**: Expose real issues with framework integration
- **Track lock files**: Commit lock files to detect dependency changes
- **Makefiles are source of truth**: No npm scripts for test commands
- **POSIX shell syntax**: Use `[ ]` not `[[ ]]` for portability

## Environment Variables

- **`BRAINTRUST_TAR`**: Path to braintrust tarball (auto-created if not set)

### CI Environment Variables

In CI, these are set to use the mock API server:

- **`BRAINTRUST_API_KEY`**: Set to `fake-test-key-framework-tests`
- **`BRAINTRUST_API_URL`**: Set to `http://localhost:8001`
- **`BRAINTRUST_APP_URL`**: Set to `http://localhost:8001`

A lightweight mock server runs on port 8001 during CI tests to handle all API calls, ensuring tests behave realistically while preventing production API hits.

### Project Names

Each scenario uses a unique project name as the first argument to `Eval()` (e.g., `test-framework-vitest`). This ensures test results are isolated and easily identifiable.

## CI Integration

Framework tests run in `sdk/.github/workflows/js.yaml` as a separate job alongside CLI tests.

## Reference Scenarios

- **vitest**: Running evals in Vitest test files (customer use case: reuse test utils)
- **jest**: Running evals in Jest test files (most popular test framework)
- **vite-node**: Running evals with vite-node for better ESM support (customer workaround)
- **tsx**: Running evals with tsx for fast TypeScript execution
- **deno**: Running evals in Deno runtime
