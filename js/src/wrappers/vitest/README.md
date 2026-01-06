# Braintrust Vitest Integration

The Braintrust Vitest wrapper provides automatic experiment tracking and dataset management for your Vitest tests.

## Quick Start

Wrap your Vitest methods to automatically create datasets and experiments from your tests. Experiments are automatically flushed and summarized after all tests complete - no manual setup required!

```typescript
import { test, expect, describe, afterAll } from "vitest";
import { wrapVitest } from "braintrust";

const bt = wrapVitest(
  { test, expect, describe, afterAll },
  { projectName: "my-project" },
);

bt.describe("Translation Tests", () => {
  // No afterAll needed - experiments flush automatically!

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
const bt = wrapVitest(
  { test, expect, describe, afterAll },
  {
    projectName: "my-project",
    displaySummary: false, // Suppress the summary output
  },
);
```

### Manual Flushing (Advanced)

In rare cases where you need manual control over flushing (e.g., custom cleanup logic), you can use `bt.flushExperiment()`:

```typescript
bt.describe("Tests", () => {
  bt.afterAll(async () => {
    // Custom cleanup logic
    await cleanup();

    // Manual flush if needed
    await bt.flushExperiment({ displaySummary: false });
  });
});
```

Note: Experiments will still auto-flush after all tests, so manual flushing is typically unnecessary.

### Test Configuration

When using the enhanced test signature:

```typescript
bt.test(
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

## Examples

### Example 1: LLM Output Evaluation

```typescript
import { wrapVitest, wrapAISDK } from "braintrust";
import { test, expect, describe, afterAll } from "vitest";
import { openai } from "@ai-sdk/openai";
import * as ai from "ai";

const { generateText } = wrapAISDK(ai);
const bt = wrapVitest(
  { test, expect, describe, afterAll },
  { projectName: "llm-eval" },
);

bt.describe("LLM Quality Tests", () => {
  bt.test(
    "generates concise responses",
    {
      input: { prompt: "Say hello in 3 words" },
      expected: { maxWords: 5 },
    },
    async ({ input, expected }) => {
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: input.prompt,
      });

      bt.logOutputs({ text: result.text });

      const wordCount = result.text.split(" ").length;
      const lengthScore = wordCount <= expected.maxWords ? 1.0 : 0.5;
      bt.logFeedback({ name: "conciseness", score: lengthScore });

      expect(wordCount).toBeLessThanOrEqual(expected.maxWords);
    },
  );
});
```

### Example 2: Translation Model Evaluation

```typescript
import { wrapVitest } from "braintrust";
import { test, expect, describe, afterAll } from "vitest";

const bt = wrapVitest(
  { test, expect, describe, afterAll },
  { projectName: "translation" },
);

bt.describe("Translation Tests", () => {
  const testCases = [
    { input: "hello", expected: "hola", language: "spanish" },
    { input: "goodbye", expected: "adiós", language: "spanish" },
    { input: "hello", expected: "bonjour", language: "french" },
  ];

  testCases.forEach(({ input, expected, language }) => {
    bt.test(
      `translates "${input}" to ${language}`,
      {
        input: { text: input, targetLang: language },
        expected,
        metadata: { category: "translation" },
      },
      async ({ input, expected }) => {
        const result = await translateText(input.text, input.targetLang);
        bt.logOutputs({ translation: result });
        expect(result.toLowerCase()).toBe(expected.toLowerCase());
      },
    );
  });
});
```

### Example 3: CI/CD Integration

```typescript
// tests/eval.eval.ts
import { wrapVitest } from "braintrust";
import { test, expect, describe, afterAll } from "vitest";

const bt = wrapVitest(
  { test, expect, describe, afterAll },
  { projectName: process.env.CI ? "prod-eval" : "dev-eval" },
);

bt.describe("Production Quality Gates", () => {
  bt.test(
    "meets accuracy threshold",
    {
      input: { testSet: "validation" },
      expected: { minAccuracy: 0.9 },
    },
    async ({ input, expected }) => {
      const result = await runModel(input.testSet);
      const accuracy = calculateAccuracy(result);

      bt.logOutputs({ accuracy, predictions: result.length });
      bt.logFeedback({ name: "accuracy", score: accuracy });

      expect(accuracy).toBeGreaterThan(expected.minAccuracy);
    },
  );
});
```

```json
// package.json
{
  "scripts": {
    "test": "vitest",
    "test:eval": "BRAINTRUST_API_KEY=$KEY vitest run **/*.eval.ts"
  }
}
```

## Best Practices

1. **Use structured data**: Log outputs as objects for better analysis in the UI
2. **Add meaningful metadata**: Include context like model version, parameters, etc.
3. **Use `.eval.ts` files**: Distinguish evaluation tests from unit tests
4. **Include input/expected**: Tests with these fields are added to datasets for tracking over time
5. **Let auto-flush work**: Experiments automatically flush after tests complete - no manual setup needed!

## Troubleshooting

### Tests run but no experiments in Braintrust

- Check that `BRAINTRUST_API_KEY` environment variable is set
- Verify project name matches an existing project or can be created
- Ensure you're using `bt.describe()` not plain `describe()`
- Verify `afterAll` is passed to `wrapVitest()` (required for auto-flushing)

### Pass/fail not showing correctly

- Pass/fail is automatically logged based on test assertions
- If test throws an error, it's marked as fail (score: 0)
- If test completes without throwing, it's marked as pass (score: 1)
- Check that tests are using standard Vitest assertions

### Datasets not being created

- Ensure tests use the enhanced signature with `input` and/or `expected`
- Verify tests are wrapped with `bt.test()` not plain `test()`
- Check that you're using `bt.describe()` not plain `describe()`

## Further Reading

- [Braintrust Experiments Documentation](https://www.braintrust.dev/docs/guides/evals)
- [Datasets Guide](https://www.braintrust.dev/docs/guides/datasets)
- [Span Tracking Guide](https://www.braintrust.dev/docs/guides/tracing)
