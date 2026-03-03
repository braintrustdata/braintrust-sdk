# Braintrust Bun Test Runner Integration

Track your Bun test results as [Braintrust](https://braintrust.dev) experiments using [bun:test](https://bun.sh/docs/test/writing).

## Quick Start

```typescript
import { test, describe, afterAll } from "bun:test";
import { initBunTestSuite } from "braintrust";

describe("My Evaluation Suite", () => {
  const suite = initBunTestSuite({
    projectName: "my-project",
    afterAll, // Auto-flush results after all tests
    test, // Required: bun:test's test function
  });

  suite.test(
    "evaluates output",
    {
      input: { text: "hello" },
      expected: "hola",
      scorers: [
        ({ output, expected }) => ({
          name: "exact_match",
          score: output === expected ? 1 : 0,
        }),
      ],
    },
    async ({ input }) => {
      return await translate(input.text);
    },
  );

  // Untracked tests use regular test() as normal
  test("sanity check", () => {
    expect(1 + 1).toBe(2);
  });
});
```

## Core Features

- **Composable**: `suite.test()` wraps `bun:test`'s `test()` — use `test()` directly for untracked tests
- **Experiment tracking**: Each test case creates a span with input, output, expected, and scores
- **Automatic scoring**: Attach scorer functions to evaluate outputs
- **Data expansion**: Use `for` loops for parameterized tests
- **Auto-flush**: Pass `afterAll` to automatically flush results when tests finish

## API Reference

### `initBunTestSuite(config)`

Creates a new test suite with Braintrust experiment tracking.

**Config:**

| Field            | Type       | Required | Description                                      |
| ---------------- | ---------- | -------- | ------------------------------------------------ |
| `projectName`    | `string`   | Yes      | Braintrust project name                          |
| `test`           | `Function` | Yes      | `test` from `bun:test`                           |
| `experimentName` | `string`   | No       | Custom experiment name (default: auto-generated) |
| `displaySummary` | `boolean`  | No       | Show summary after flush (default: `true`)       |
| `afterAll`       | `Function` | No       | `afterAll` from `bun:test` for auto-flush        |
| `onProgress`     | `Function` | No       | Callback for progress events                     |

**Returns:** `BunTestSuite` with `test`, `it`, and `flush()`.

### `suite.test(name, config, fn)`

Creates a traced test case.

**Parameters:**

| Parameter | Type         | Description                           |
| --------- | ------------ | ------------------------------------- |
| `name`    | `string`     | Test name (used as span name)         |
| `config`  | `EvalConfig` | Input, expected, scorers, etc.        |
| `fn`      | `Function`   | Test function receiving `EvalContext` |

**EvalConfig:**

| Field      | Type                      | Description                         |
| ---------- | ------------------------- | ----------------------------------- |
| `input`    | `unknown`                 | Test input data                     |
| `expected` | `unknown`                 | Expected output (passed to scorers) |
| `metadata` | `Record<string, unknown>` | Custom metadata                     |
| `tags`     | `string[]`                | Tags for organizing test cases      |
| `scorers`  | `ScorerFunction[]`        | Scorer functions                    |
| `name`     | `string`                  | Override span name                  |

### Test Modifiers

All modifiers from `bun:test` are supported:

```typescript
suite.test.skip("skipped test", config, fn);
suite.test.only("focused test", config, fn);
suite.test.todo("planned test");
suite.test.failing("expected failure", config, fn);
suite.test.concurrent("parallel test", config, fn);
suite.test.serial("sequential test", config, fn);

// Conditional modifiers
suite.test.if(condition)("conditional test", config, fn);
suite.test.skipIf(condition)("skip-if test", config, fn);
suite.test.todoIf(condition)("todo-if test", config, fn);
```

`suite.it` is an alias for `suite.test`.

## Using Scorers

```typescript
// Basic scorer
suite.test(
  "my test",
  {
    input: "hello",
    expected: "HELLO",
    scorers: [
      ({ output, expected }) => ({
        name: "exact_match",
        score: output === expected ? 1 : 0,
      }),
    ],
  },
  async ({ input }) => (input as string).toUpperCase(),
);

// Multiple scorers
suite.test(
  "multi-scored",
  {
    input: "hello world",
    expected: "Hola mundo",
    scorers: [
      ({ output, expected }) => ({
        name: "exact_match",
        score: String(output) === String(expected) ? 1 : 0,
      }),
      ({ output }) => ({
        name: "not_empty",
        score: String(output).length > 0 ? 1 : 0,
      }),
    ],
  },
  async ({ input }) => await translate(input),
);
```

## Data Expansion

Use `for` loops instead of `test.each` for parameterized tests:

```typescript
const cases = [
  { input: "hello", expected: "hola" },
  { input: "goodbye", expected: "adiós" },
];

for (const [i, record] of cases.entries()) {
  suite.test(
    `translation [${i}]: ${record.input}`,
    {
      input: record.input,
      expected: record.expected,
      scorers: [myScorer],
    },
    async ({ input }) => await translate(input as string),
  );
}
```

## Custom Logging with `currentSpan()`

```typescript
import { currentSpan } from "braintrust";

suite.test(
  "with custom logging",
  { input: { query: "test" } },
  async ({ input }) => {
    const result = await myFunction(input);

    currentSpan().log({
      output: { tokens: result.usage, model: result.model },
      scores: { human_quality: 0.95 },
      metadata: { evaluator: "example" },
    });

    return result.text;
  },
);
```

## Running

```bash
bun test
```

## Additional Resources

- [Braintrust Documentation](https://www.braintrust.dev/docs)
- [Bun Test Runner](https://bun.sh/docs/test/writing)
