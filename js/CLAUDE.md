# JavaScript SDK

Run commands from the `js/` directory unless noted otherwise.

## Running Tests

```bash
make test                    # Full JS test suite (core + wrappers)
```

**Run a single test:**

```bash
pnpm test -- -t "test name"  # Filters within core vitest suite
```

**Build:**

```bash
pnpm build
```

## Linting & Formatting

From the repository root:

```bash
pnpm run formatting          # Check formatting
pnpm run lint                # Run eslint checks
pnpm run fix:formatting      # Auto-fix formatting
pnpm run fix:lint            # Auto-fix eslint issues
```

## Before Committing

Always run formatting before committing to avoid pre-commit hook failures:

```bash
pnpm run fix:formatting      # Format all files
```

## Test Framework

Uses Vitest. Most tests are local/mocked, while some wrapper tests require real API keys.

```bash
# Required env vars for wrapper tests
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```
