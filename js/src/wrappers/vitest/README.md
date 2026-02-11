# Braintrust Vitest Integration

The Braintrust Vitest wrapper provides automatic experiment tracking and dataset management for your Vitest tests.

## Quick Start

Wrap your Vitest methods to automatically create datasets and experiments from your tests. Experiments are automatically flushed and summarized after all tests complete - no manual setup required!

```typescript
import * as vitest from "vitest";
import { wrapVitest } from "braintrust";

const { describe, test, expect, afterAll, beforeAll, logOutputs, logFeedback } =
  wrapVitest(vitest, { projectName: "my-project" });

bt.describe("Translation Tests", () => {
  // Tests with input/expected are automatically added to the dataset
  bt.test(
    "translates hello",
    {
      input: { text: "hello" },
      expected: "hola",
      metadata: { language: "spanish" },
      tags: ["translation"],
    },
    async ({ input, expected }) => {
      const result = await translate(input.text);
      bt.logOutputs({ translation: result });
      expect(result).toBe(expected);
    },
  );

  // Tests without input/expected still track pass/fail
  bt.test("basic test", async () => {
    const result = await someFunction();
    expect(result).toBeTruthy();
  });
});
```

## What It Provides

✅ **Automatic Dataset Creation**: `describe()` block creates a dataset with the suite name
✅ **Automatic Example Addition**: Tests with `input`/`expected` are added to the dataset
✅ **Experiment per Run**: Each test run creates a new experiment
✅ **Automatic Flushing**: Experiments automatically flush and display summaries when tests complete
✅ **Pass/Fail Collection**: Pass/fail rate collected under the `pass` feedback key
✅ **Experiment Comparison**: Compare runs in the Braintrust UI
✅ **Dataset Reuse**: Dataset persists across runs, examples aren't duplicated

Configure Vitest to include `.eval.ts` files:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts", "**/*.eval.ts"],
  },
});
```

## API Reference

### wrapVitest(vitestMethods, config)

Wraps Vitest methods with Braintrust experiment tracking.

**Parameters:**

- `vitestMethods` - Object containing Vitest functions: `{ test, expect, describe, afterAll }`
- `config` - Optional configuration object:
  - `projectName?: string` - Project name for the experiment (defaults to suite name)
  - `displaySummary?: boolean` - If true, displays experiment summary after flushing (defaults to true)

**Returns:** Object with wrapped methods and logging utilities:

- `test` / `it` - Wrapped test function
- `describe` - Wrapped describe function
- `expect` - Pass-through of original expect
- `beforeAll`, `afterAll`, `beforeEach`, `afterEach` - Pass-through of lifecycle hooks
- `logOutputs(outputs)` - Log custom outputs to current span
- `logFeedback(feedback)` - Log custom metrics to current span
- `getCurrentSpan()` - Get current span for advanced use cases

### Customizing Summary Display

By default, a formatted experiment summary is displayed after all tests complete. You can suppress this by setting `displaySummary: false`:

```typescript
const { test, expect, describe, afterAll } = wrapVitest(vitest, {
  projectName: "my-project",
  displaySummary: false, // Suppress the summary output
});
```

### Manual Flushing (Advanced)

In rare cases where you need manual control over flushing (e.g., custom cleanup logic), you can use `bt.flushExperiment()`:

```typescript
describe("Tests", () => {
  afterAll(async () => {
    // Custom cleanup logic
    await cleanup();

    // Manual flush if needed
    await flushExperiment({ displaySummary: false });
  });
});
```

Note: Experiments will still auto-flush after all tests, so manual flushing is typically unnecessary.

### Test Configuration

When using the enhanced test signature:

```typescript
test(
  'test name',
  {
    input: any,           // Test input data
    expected: any,        // Expected output
    metadata?: object,    // Additional metadata
    tags?: string[],      // Tags for organization
  },
  async ({ input, expected, metadata }) => {
    // Test implementation
  }
);
```
