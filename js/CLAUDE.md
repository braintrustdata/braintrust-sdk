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

## Test Framework

Uses Vitest. Config in `vitest.config.js`.

```typescript
import { describe, it, expect } from "vitest";

describe("module", () => {
  it("should do something", () => {
    expect(value).toBe(expected);
  });
});
```
