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

```bash
pnpm prettier --write <files>
pnpm eslint <files>
```

Or from sdk root:

```bash
make fixup                   # Run pre-commit hooks on all files
```

## Before Committing

Always run formatting before committing to avoid pre-commit hook failures:

```bash
pnpm prettier --write .      # Format all files
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
