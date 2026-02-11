# Braintrust Vitest Integration

The Braintrust Vitest wrapper provides automatic experiment tracking, dataset management, and evaluation scoring for your Vitest tests. It seamlessly integrates Braintrust's evaluation framework into your testing workflow.

## Quick Start

```typescript
import { test, expect, describe, afterAll } from "vitest";
import { wrapVitest } from "braintrust";

const bt = wrapVitest(
  { test, expect, describe, afterAll },
  { projectName: "my-project" },
);

bt.describe("Translation Tests", () => {
  bt.test(
    "translates hello",
    {
      input: { text: "hello" },
      expected: "hola",
      metadata: { language: "spanish" },
    },
    async ({ input, expected }) => {
      const result = await translate(input.text);
      bt.logOutputs({ translation: result });
      expect(result).toBe(expected);
    },
  );

  bt.afterAll(async () => {
    await bt.flushExperiment();
  });
});
```

## Core Features

### ✅ Automatic Experiment Tracking

- Each `describe()` block creates a Braintrust experiment
- Test pass/fail rates automatically logged
- Experiments can be compared in the Braintrust UI

### ✅ Automatic Scoring with Scorers

- Automatically evaluate test outputs with custom or built-in scorers
- Scores logged to Braintrust for analysis
- Support for multiple scorers per test

### ✅ Dataset Integration

- Use existing Braintrust datasets for test cases
- Define inline test data that auto-expands to multiple tests
- Combine datasets with automatic scoring for comprehensive evaluations

### ✅ Logging & Metadata

- Log custom outputs and feedback within tests
- Attach metadata and tags for organization
- Access current span for advanced use cases

---

## Using Scorers

Scorers automatically evaluate your test outputs and log scores to Braintrust. Perfect for LLM evaluations, quality checks, and automated grading.

### Basic Scorer Usage

```typescript
bt.test(
  "translation quality",
  {
    input: { text: "hello world" },
    expected: "hola mundo",
    scorers: [
      // Custom scorer function
      ({ output, expected }) => ({
        name: "exact_match",
        score: output === expected ? 1 : 0,
      }),
    ],
  },
  async ({ input }) => {
    const result = await translate(input.text);
    return result; // Return value is passed to scorers as "output"
  },
);
```

**Key Points:**

- Scorers receive `{ output, expected, input, metadata }`
- Test function **must return a value** for scorers to evaluate
- Scorers run automatically after test completes (even if test fails)

### Using Built-in Scorers

Import scorers from the `autoevals` package for common evaluation tasks:

```typescript
import { Levenshtein, Factuality, EmbeddingSimilarity } from "autoevals";

bt.test(
  "LLM output quality",
  {
    input: { prompt: "Explain quantum computing" },
    expected: "Quantum computing uses quantum mechanics...",
    scorers: [
      Factuality, // Check factual accuracy
      Levenshtein, // Calculate string similarity
      EmbeddingSimilarity, // Semantic similarity
    ],
  },
  async ({ input }) => {
    const response = await llm.generate(input.prompt);
    return response;
  },
);
```

**Available Built-in Scorers:**

- **Factuality** - Verify factual accuracy against expected output
- **Levenshtein** - Edit distance similarity
- **EmbeddingSimilarity** - Semantic similarity using embeddings
- **ClosedQA** - Question answering correctness
- **ValidJSON** - JSON structure validation
- And many more from [`autoevals`](https://www.braintrust.dev/docs/autoevals)

### Custom Scorers

Create your own scorer functions for domain-specific evaluation:

```typescript
// Simple scorer
const lengthScorer = ({ output }) => ({
  name: "appropriate_length",
  score: output.length >= 50 && output.length <= 200 ? 1 : 0.5,
  metadata: { actual_length: output.length },
});

// Advanced scorer with async logic
const customScorer = async ({ output, expected, input }) => {
  const similarity = await calculateSimilarity(output, expected);
  return {
    name: "custom_similarity",
    score: similarity,
    metadata: {
      input_tokens: input.text.split(" ").length,
      output_tokens: output.split(" ").length,
    },
  };
};

bt.test(
  "test with custom scorers",
  {
    input: { text: "Write a summary" },
    expected: "This is a good summary",
    scorers: [lengthScorer, customScorer],
  },
  async ({ input }) => {
    return await generateSummary(input.text);
  },
);
```

### Multiple Scorers

Run multiple scorers to evaluate different aspects of output:

```typescript
bt.test(
  "comprehensive evaluation",
  {
    input: { prompt: "Write a poem" },
    expected: { hasRhyme: true, sentiment: "positive" },
    scorers: [
      ({ output }) => ({
        name: "has_rhyme",
        score: detectRhyme(output) ? 1 : 0,
      }),
      ({ output }) => ({
        name: "positive_sentiment",
        score: analyzeSentiment(output) === "positive" ? 1 : 0,
      }),
      ({ output }) => ({
        name: "appropriate_length",
        score: output.split("\n").length >= 4 ? 1 : 0.5,
      }),
    ],
  },
  async ({ input }) => {
    return await generatePoem(input.prompt);
  },
);
```

### Scorer Return Types

Scorers are flexible and can return different formats:

```typescript
// Score object (recommended)
({ output }) => ({ name: "my_score", score: 0.8, metadata: { details: "..." } })

// Number directly (will use "score" as the name)
({ output }) => 0.75

// Null to skip scoring
({ output }) => output ? 1 : null

// Array of scores
({ output }) => [
  { name: "accuracy", score: 0.9 },
  { name: "fluency", score: 0.85 },
]
```

---

## Working with Datasets

Datasets let you run the same test logic across multiple input/expected pairs. You can define data inline or load from existing Braintrust datasets.

### Option 1: Inline Data

Define test cases directly in your test configuration:

```typescript
bt.test(
  "translation test",
  {
    data: [
      { input: { text: "hello" }, expected: "hola" },
      { input: { text: "goodbye" }, expected: "adiós" },
      { input: { text: "thank you" }, expected: "gracias" },
    ],
    scorers: [Levenshtein], // Optional: add scorers
  },
  async ({ input, expected }) => {
    const result = await translate(input.text);
    return result;
  },
);
```

**What happens:**

- Creates **3 separate tests** (one per data record)
- Each test named: `"translation test [0]"`, `"translation test [1]"`, etc.
- Each test receives its own `input` and `expected` values
- Scorers run on each test automatically

### Option 2: Load from Braintrust Dataset

Fetch test cases from an existing Braintrust dataset.

```typescript
import { initDataset } from "braintrust";

// Load dataset at test registration time
const testData = await initDataset({
  project: "my-project",
  dataset: "translations-v1",
  version: "latest", // optional: specify version
}).fetchedData();

bt.describe("Translation Suite", () => {
  // Use loaded data with the data field
  bt.test(
    "translation test",
    {
      data: testData, // Available at registration time
      scorers: [Levenshtein, Factuality],
    },
    async ({ input, expected }) => {
      const result = await translate(input.text);
      return result;
    },
  );

  bt.afterAll(async () => {
    await bt.flushExperiment();
  });
});
```

**Dataset Options:**

```typescript
import { initDataset } from "braintrust";

initDataset({
  project: "my-project", // Project name or ID
  dataset: "my-dataset", // Dataset name or ID
  version: "v1.2", // Optional: specific version
  description: "...", // Optional: description
}).fetchedData();
```

### Combining Datasets with Scorers

The most powerful pattern combines datasets with automatic scoring:

```typescript
import { initDataset } from "braintrust";

bt.describe("LLM Evaluation Suite", () => {
  const evalData = initDataset({
    project: "llm-evals",
    dataset: "qa-benchmark",
  }).fetchedData();

  bt.test.each(await evalData)(
    "Q&A evaluation",
    {
      scorers: [
        Factuality,
        ({ output, expected }) => ({
          name: "conciseness",
          score: output.length <= expected.length * 1.2 ? 1 : 0.7,
        }),
      ],
    },
    async (record) => {
      const { input, expected } = record;
      const answer = await llm.answer(input.question);
      return answer;
    },
  );

  bt.afterAll(async () => {
    await bt.flushExperiment();
  });
});
```

**Benefits:**

- Centralized test data in Braintrust
- Version control for datasets
- Automatic scoring across all examples
- Easy comparison across experiment runs
- Reuse datasets across different test suites

---

## API Reference

### wrapVitest(vitestMethods, config)

Wraps Vitest methods with Braintrust experiment tracking.

**Parameters:**

```typescript
wrapVitest(
  vitestMethods: {
    test: TestFunction;
    expect: any;
    describe: DescribeFunction;
    afterAll?: (fn: () => void | Promise<void>) => void;
    beforeAll?: (fn: () => void | Promise<void>) => void;
    beforeEach?: (fn: (context: any) => void | Promise<void>) => void;
    afterEach?: (fn: (context: any) => void | Promise<void>) => void;
  },
  config?: {
    projectName?: string;        // Project name (defaults to suite name)
    displaySummary?: boolean;    // Show summary after tests (default: true)
    onProgress?: (event: ProgressEvent) => void;  // Progress callback
  }
)
```

**Returns:**

```typescript
{
  test: WrappedTest;           // Enhanced test function
  it: WrappedTest;             // Alias for test
  describe: WrappedDescribe;   // Enhanced describe function
  expect: any;                 // Pass-through expect
  beforeAll: Function;         // Lifecycle hooks
  afterAll: Function;
  beforeEach?: Function;
  afterEach?: Function;

  // Utility functions
  logOutputs: (outputs: Record<string, unknown>) => void;
  logFeedback: (feedback: { name: string; score: number; metadata?: object }) => void;
  getCurrentSpan: () => Span | null;
  flushExperiment: (options?: { displaySummary?: boolean }) => Promise<void>;
}
```

### Test Configuration

Enhanced test signature with full options:

```typescript
bt.test(
  "test name",
  {
    // Test data
    input?: any,              // Test input
    expected?: any,           // Expected output
    metadata?: object,        // Custom metadata
    tags?: string[],          // Organization tags

    // NEW: Scorers
    scorers?: ScorerFunction[],  // Array of scorer functions

    // NEW: Inline data
    data?: Array<{            // Auto-expand to multiple tests
      input?: any;
      expected?: any;
      metadata?: object;
      tags?: string[];
    }>,

    // Vitest options (passed through)
    timeout?: number,
    retry?: number,
    // ... any other vitest options
  },
  async ({ input, expected, metadata }) => {
    // Test implementation
    const result = await yourFunction(input);
    return result;  // Return value used by scorers
  }
);
```

### Logging Functions

#### logOutputs(outputs)

Log custom outputs to the current test span:

```typescript
bt.logOutputs({
  translation: result,
  confidence: 0.95,
  model: "gpt-4",
});
```

#### logFeedback(feedback)

Log custom scores/metrics to the current test span:

```typescript
bt.logFeedback({
  name: "custom_metric",
  score: 0.85,
  metadata: { reasoning: "..." },
});
```

---

## Advanced Usage

### Progress Monitoring

Monitor test progress in real-time:

```typescript
const bt = wrapVitest(
  { test, expect, describe, afterAll },
  {
    projectName: "my-project",
    onProgress: (event) => {
      if (event.type === "test_complete") {
        console.log(
          `✓ ${event.testName}: ${event.passed ? "PASS" : "FAIL"} (${event.duration}ms)`,
        );
      }
    },
  },
);
```

### Manual Flush Control

For custom cleanup logic or conditional summary display:

```typescript
bt.describe("Custom Tests", () => {
  bt.afterAll(async () => {
    // Custom cleanup
    await cleanup();

    // Manual flush with options
    await bt.flushExperiment({
      displaySummary: process.env.CI !== "true", // Only show summary locally
    });
  });
});
```

### Accessing Current Span

For advanced use cases, access the current Braintrust span:

```typescript
bt.test("advanced test", async () => {
  const span = bt.getCurrentSpan();
  if (span) {
    span.log({ custom_data: { ... } });
  }

  // Test logic
});
```

---

## Complete Examples

### Example 1: Simple Scorer Evaluation

```typescript
import { test, expect, describe, afterAll } from "vitest";
import { wrapVitest } from "braintrust";
import { Levenshtein } from "autoevals";

const bt = wrapVitest(
  { test, expect, describe, afterAll },
  { projectName: "translation-eval" },
);

bt.describe("Translation Quality", () => {
  bt.test(
    "translates accurately",
    {
      input: { text: "hello world", lang: "es" },
      expected: "hola mundo",
      scorers: [
        Levenshtein,
        ({ output, expected }) => ({
          name: "exact_match",
          score: output.toLowerCase() === expected.toLowerCase() ? 1 : 0,
        }),
      ],
    },
    async ({ input, expected }) => {
      const result = await translate(input.text, input.lang);
      return result;
    },
  );

  bt.afterAll(async () => {
    await bt.flushExperiment();
  });
});
```

### Example 2: Dataset with Multiple Scorers

```typescript
import { test, expect, describe, afterAll } from "vitest";
import { wrapVitest } from "braintrust";
import { Factuality, EmbeddingSimilarity } from "autoevals";

const bt = wrapVitest(
  { test, expect, describe, afterAll },
  { projectName: "llm-qa-eval" },
);

bt.describe("LLM Q&A Evaluation", () => {
  const qaData = initDataset({
    project: "qa-benchmarks",
    dataset: "science-questions",
  }).fetchedData();

  bt.test.each(await qaData)(
    "answer quality",
    {
      scorers: [
        Factuality,
        EmbeddingSimilarity,
        ({ output }) => ({
          name: "no_hallucination",
          score: !containsHallucination(output) ? 1 : 0,
        }),
      ],
    },
    async (record) => {
      const { input, expected } = record;
      const answer = await llm.answer(input.question);
      return answer;
    },
  );

  bt.afterAll(async () => {
    await bt.flushExperiment();
  });
});
```

### Example 3: Inline Data with Custom Scorers

```typescript
import { test, expect, describe, afterAll } from "vitest";
import { wrapVitest } from "braintrust";

const bt = wrapVitest(
  { test, expect, describe, afterAll },
  { projectName: "sentiment-analysis" },
);

bt.describe("Sentiment Analysis Tests", () => {
  bt.test(
    "classifies sentiment correctly",
    {
      data: [
        { input: { text: "I love this!" }, expected: "positive" },
        { input: { text: "This is terrible" }, expected: "negative" },
        { input: { text: "It's okay" }, expected: "neutral" },
        { input: { text: "Amazing experience!" }, expected: "positive" },
      ],
      scorers: [
        ({ output, expected }) => ({
          name: "accuracy",
          score: output === expected ? 1 : 0,
        }),
        ({ output, input }) => ({
          name: "confidence",
          score: getSentimentConfidence(output, input.text),
        }),
      ],
    },
    async ({ input }) => {
      const sentiment = await analyzeSentiment(input.text);
      return sentiment;
    },
  );

  bt.afterAll(async () => {
    await bt.flushExperiment();
  });
});
```

---

## TypeScript Types

All types are exported for your convenience:

```typescript
import type {
  TestConfig,
  TestContext,
  Score,
  ScorerFunction,
  DatasetOptions,
  DatasetRecord,
  BraintrustVitest,
  WrapperConfig,
} from "braintrust";

// Define a custom scorer with types
const myScorer: ScorerFunction = ({ output, expected, input, metadata }) => {
  return {
    name: "my_scorer",
    score: calculateScore(output, expected),
    metadata: { input_length: JSON.stringify(input).length },
  };
};
```

---

## Best Practices

### Scorers

1. **Keep scorers simple and fast** - They run on every test
2. **Use multiple scorers** - Evaluate different quality aspects
3. **Include metadata** - Add debugging context to score results
4. **Handle edge cases** - Return `null` to skip scoring when appropriate
5. **Test scorers independently** - Verify scorer logic before using in evals

### Datasets

1. **Version your datasets** - Use semantic versioning for dataset changes
2. **Start with inline data** - Develop tests locally before moving to datasets
3. **Organize by domain** - Group related test cases in the same dataset
4. **Keep datasets focused** - One dataset per specific evaluation task
5. **Document expected format** - Add metadata describing input/expected structure

### General

1. **One experiment per describe block** - Keeps results organized
2. **Use meaningful project names** - Easy to find in Braintrust UI
3. **Tag tests appropriately** - Enables filtering and analysis
4. **Log intermediate outputs** - Use `logOutputs()` for debugging
5. **Review results in Braintrust** - Compare runs and identify regressions

---

## Troubleshooting

### Scorers not running

- ✅ Ensure test function returns a value
- ✅ Check that scorers array is not empty
- ✅ Verify scorer functions don't throw errors (check console for warnings)

### Tests not creating

- ✅ Verify `describe()` block is wrapped (`bt.describe()`)
- ✅ Check that `afterAll` is passed to `wrapVitest()`
- ✅ Ensure you're calling `bt.flushExperiment()` in `afterAll`

### Dataset not loading

- ✅ Verify project and dataset names are correct
- ✅ Check API key is configured (`BRAINTRUST_API_KEY`)
- ✅ Ensure dataset exists in Braintrust UI
- ✅ Use `await` when loading dataset

### Scores not appearing

- ✅ Check scorer returns correct format (Score object or number)
- ✅ Verify test return value is not `undefined`
- ✅ Look for scorer errors in console output
- ✅ Ensure experiment is flushed after tests

---

## Additional Resources

- [Braintrust Documentation](https://www.braintrust.dev/docs)
- [Autoevals Library](https://www.braintrust.dev/docs/autoevals)
- [Example Vitest Integration](./example.test.ts)
- [Vitest Documentation](https://vitest.dev/)
