# JavaScript SDK

Run commands from the `js/` directory unless noted otherwise.

## Running Tests

```bash
make test                    # Full JS test suite (core + wrappers)
make test-core               # Core tests only
make test-openai             # OpenAI wrapper matrix tests
make test-anthropic          # Anthropic wrapper matrix tests
make test-google-genai       # Google GenAI wrapper tests
make test-ai-sdk             # AI SDK wrapper tests (v5 + v6)
make test-vitest             # Vitest wrapper tests
make test-claude-agent-sdk   # Claude Agent SDK wrapper tests
make test-api-compat         # API compatibility test
make test-smoke              # Smoke tests (delegates to smoke/Makefile)
make clean                   # Remove build artifacts
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
pnpm run lint                # Check formatting + eslint
pnpm run fix                 # Auto-fix formatting + eslint
pnpm run lint:prettier       # Check formatting only
pnpm run lint:eslint         # Run eslint only
pnpm run fix:prettier        # Auto-fix formatting only
pnpm run fix:eslint          # Auto-fix eslint only
```

## Before Committing

Always run formatting before committing to avoid pre-commit hook failures:

```bash
pnpm run fix:prettier        # Format all files
```

## Test Framework

Uses Vitest. Most tests are local/mocked, while some wrapper tests require real API keys.

```bash
# Required env vars for wrapper tests
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```
