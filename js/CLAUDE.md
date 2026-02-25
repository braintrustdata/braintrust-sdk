# JavaScript SDK

## Running Tests

```bash
make test                    # All tests
make test-core               # Core tests only
make test-openai             # OpenAI wrapper
make test-anthropic          # Anthropic wrapper
make clean                   # Remove build artifacts
```

**Run a single test:**

```bash
pnpm test -- -t "test name"
```

**Build:**

```bash
pnpm build
```

## Linting & Formatting

From the sdk root:

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

Uses Vitest. Config in `vitest.config.js`. Tests make real API calls.

```bash
# Required env vars for wrapper tests
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

```typescript
import { describe, it, expect } from "vitest";

describe("module", () => {
  it("should do something", () => {
    expect(value).toBe(expected);
  });
});
```
