# JavaScript SDK

Run commands from the `js/` directory unless noted otherwise.

## Running Tests

```bash
pnpm run test:checks             # Hermetic tests (core + vitest wrapper)
pnpm run test:external            # Provider-backed tests (OpenAI, Anthropic, etc.)
pnpm run test:all                 # Everything (checks + external)
pnpm test                         # Core vitest suite only
```

**Individual provider tests:**

```bash
pnpm run test:external:openai          # OpenAI wrapper
pnpm run test:external:anthropic       # Anthropic wrapper
pnpm run test:external:google-genai    # Google GenAI wrapper
pnpm run test:external:ai-sdk          # AI SDK (v5 + v6)
pnpm run test:external:claude-agent-sdk # Claude Agent SDK
```

**Test a specific version of a provider:**

```bash
./scripts/test-provider.sh test:openai openai@4.92.1
./scripts/test-provider.sh test:anthropic @anthropic-ai/sdk@0.39.0
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
