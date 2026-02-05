# Braintrust CLI Tests

Test suite for Braintrust CLI commands (`braintrust eval`, `braintrust push`, etc.).

## Quick Reference

```bash
# From sdk/js/cli-tests/:
make test                          # Run all scenarios
make list                          # List available scenarios
make clean                         # Clean all scenarios
cd scenarios/eval-esm && make test # Run specific scenario

# From a specific scenario:
cd scenarios/eval-esm
make test                          # Auto-creates tarball if needed
make clean                         # Remove artifacts
```

## Purpose

This test suite verifies that CLI commands work correctly with the built SDK package. Unlike smoke tests (which test the SDK library across different environments), these tests focus on CLI command functionality.

## Structure

Tests are organized into scenarios under `scenarios/`:

```
scenarios/
├── eval-esm/          # Test 'braintrust eval' with ESM modules
├── eval-cjs/          # Future: Test with CommonJS
├── push-basic/        # Future: Test 'braintrust push'
└── init-basic/        # Future: Test 'braintrust init'
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

### Example Scenario Structure

```
scenarios/my-scenario/
├── Makefile           # setup + test targets
├── package.json       # Dependencies only
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
	@npm install

test: setup
	@echo "==> Running my-scenario tests"
	@npx braintrust <command> tests/test.eval.ts --no-send-logs

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
- **Minimal logging**: Clear test output, errors only
- **Run all tests**: Don't exit early, run all tests and report summary

## Environment Variables

- **`BRAINTRUST_TAR`**: Path to braintrust tarball (auto-created if not set)

## CI Integration

CLI tests run in `sdk/.github/workflows/js.yaml` as a separate job that:

- Downloads build artifacts from the build job
- Runs `make test` to execute all scenarios
- Tests on Ubuntu + Windows, Node 20 + 22

## Reference Scenarios

- **eval-esm**: Tests ESM support in `braintrust eval` command
