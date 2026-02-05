# Braintrust CLI Tests

Test suite for Braintrust CLI commands (`braintrust eval`, `braintrust push`, etc.).

## Distinction from Framework Tests

- **CLI Tests** (this directory): Test the `braintrust eval` CLI command with different module systems and runtimes
- **Framework Tests** (`sdk/js/framework-tests/`): Test calling `Eval()` API directly in various frameworks (Jest, Vitest, etc.)

## Prerequisites

- Node.js (for running the tests)
- npm (for installing dependencies)
- `mise` (for runtime management in Bun scenarios)
- A built tarball of the Braintrust SDK

Some scenarios (Bun) require `mise` to automatically install the correct runtime versions. See each scenario's `.tool-versions` file for required versions.

## Quick Reference

```bash
# From sdk/js/cli-tests/:
make test                           # Run all scenarios
make list                           # List available scenarios
make clean                          # Clean all scenarios
cd scenarios/eval-esm && make test  # Run specific scenario

# From a specific scenario:
cd scenarios/eval-esm
make test                           # Auto-creates tarball if needed
make clean                          # Remove artifacts
```

## Purpose

This test suite verifies that CLI commands work correctly with the built SDK package. Unlike smoke tests (which test the SDK library across different environments), these tests focus on CLI command functionality.

## Structure

Tests are organized into scenarios under `scenarios/`:

```
scenarios/
# Runtime Scenarios
├── eval-esm/          # Pure JavaScript ESM (Node.js, .mjs files)
├── eval-cjs/          # Pure JavaScript CommonJS (Node.js, .js files)
├── eval-bun/          # Bun runtime with bun CLI
├── eval-deno/         # Deno runtime with deno run npm:braintrust
├── eval-bun-npm/      # npm CLI (Node.js) on Bun-style TypeScript
├── eval-deno-npm/     # npm CLI (Node.js) on Deno-style TypeScript

# TypeScript Bundling Scenarios
├── eval-ts-esm/       # TypeScript → ESM output
└── eval-ts-cjs/       # TypeScript → CJS output
```

Each scenario is an independent npm package that:

- Installs the built SDK tarball
- Runs CLI commands against test files
- Validates output and exit codes

## Creating a New Scenario

### Requirements

- Makefile with `setup` and `test` targets
- package.json (dependencies only, no scripts)
- README.md explaining design decisions (15-25 lines)
- .gitignore (ignore artifacts, track lock files)
- Test files (e.g., `tests/*.eval.ts` for eval scenarios)
- POSIX shell syntax (`[ ]` not `[[ ]]`)
- `.tool-versions` file (if scenario requires non-Node runtimes like Bun/Deno)

### Example Scenario Structure

```
scenarios/my-scenario/
├── Makefile           # setup + test targets
├── package.json       # Dependencies only
├── .tool-versions     # Optional: for non-Node runtimes (Bun, Deno)
├── tests/
│   └── test.eval.ts
├── .gitignore
└── README.md
```

### Example Makefile

```makefile
.PHONY: setup test clean

# Auto-create tarball if not provided
BRAINTRUST_TAR ?= $(shell \
	cd ../../.. && \
	pnpm exec turbo build --filter=braintrust && \
	mkdir -p artifacts && \
	VERSION=$$(node -p "require('./package.json').version") && \
	pnpm pack --pack-destination artifacts && \
	echo "$$PWD/artifacts/braintrust-$$VERSION.tgz")

setup:
	@echo "==> Setting up my-scenario"
	@if [ ! -f "$(BRAINTRUST_TAR)" ]; then \
		echo "Error: Tarball not found"; exit 1; \
	fi
	@cp "$(BRAINTRUST_TAR)" braintrust-latest.tgz
	# If using non-Node runtime (Bun, Deno), add:
	# @mise install
	@npm install

test: setup
	@echo "==> Running my-scenario tests"
	# For Node/npm:
	@npx braintrust <command> tests/test.eval.ts --jsonl 2>&1 | ../../validate-jsonl.sh
	# For Bun:
	# @mise exec -- bun run braintrust <command> tests/test.eval.ts --jsonl 2>&1 | ../../validate-jsonl.sh
	# For Deno:
	# @mise exec -- deno run --allow-env --allow-read --allow-net tests/test.ts --jsonl 2>&1 | ../../validate-jsonl.sh

clean:
	@rm -rf node_modules braintrust-latest.tgz package-lock.json
```

## Auto-Discovery

The top-level Makefile automatically discovers all scenarios:

```makefile
SCENARIOS := $(shell find scenarios -mindepth 1 -maxdepth 1 -type d \
  -exec test -f {}/Makefile \; -print | sed 's|scenarios/||')
```

Any folder in `scenarios/` with a Makefile is automatically included in `make test` and `make list`.

## Design Principles

- **Well-known tarball paths**: Use `braintrust-latest.tgz` not version-specific paths
- **No workarounds**: No `--legacy-peer-deps`, `--no-check`, etc. - expose real issues
- **Build before install**: Build artifacts BEFORE npm install
- **Track lock files**: Commit `package-lock.json` to detect dependency changes
- **Makefiles are source of truth**: No npm scripts, all commands in Makefile
- **POSIX shell syntax**: Use `[ ]` not `[[ ]]` for portability
- **JSONL validation**: Tests use `--jsonl` flag and validate output to ensure evaluators actually ran
- **Visible output**: Full command output shown for debugging (no `/dev/null`)
- **Run all tests**: Don't exit early, run all tests and report summary
- **Mock API server**: Tests send logs to a mock server running on localhost:8001

## Environment Variables

- **`BRAINTRUST_TAR`**: Path to braintrust tarball (auto-created if not set)

### CI Environment Variables

In CI, these are set to use the mock API server:

- **`BRAINTRUST_API_KEY`**: Set to `fake-test-key-cli-tests`
- **`BRAINTRUST_API_URL`**: Set to `http://localhost:8001`
- **`BRAINTRUST_APP_URL`**: Set to `http://localhost:8001`

A lightweight mock server runs on port 8001 during CI tests to handle all API calls, ensuring tests behave realistically while preventing production API hits.

### Project Names

Each scenario uses a unique project name as the first argument to `Eval()` (e.g., `test-cli-eval-esm`). This ensures test results are isolated and easily identifiable.

## CI Integration

CLI tests run in `sdk/.github/workflows/js.yaml` as a separate job that:

- Downloads build artifacts from the build job
- Runs `make test` to execute all scenarios
- Tests on Ubuntu + Windows, Node 20 + 22

## Reference Scenarios

- **eval-esm**: Tests pure JavaScript ESM support in `braintrust eval` command
- **eval-cjs**: Tests CommonJS support in `braintrust eval` command
- **eval-ts-esm**: Tests TypeScript ESM support in `braintrust eval` command
- **eval-ts-cjs**: Tests TypeScript CJS support in `braintrust eval` command
- **eval-bun**: Tests `braintrust eval` with Bun runtime
- **eval-deno**: Tests `braintrust eval` with Deno-style TypeScript files
