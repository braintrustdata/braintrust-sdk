import * as vitest from "vitest";
import { configureNode } from "../../src/node";
import { wrapVitest } from "../../src/wrappers/vitest/index";
import { _exportsForTestingOnly, login, initDataset } from "../../src/logger";
import { wrapOpenAI } from "../../src/wrappers/oai";
import OpenAI from "openai";

configureNode();

// Track test progress
let totalTests = 0;
let completedTests = 0;

// Create wrapped vitest with enhanced progress reporting
const bt = wrapVitest(vitest, {
  projectName: "example-vitest",
  displaySummary: true, // Show experiment summary at the end
  onProgress: (event) => {
    // Progress reporting
    switch (event.type) {
      case "suite_start":
        console.log(`Starting suite: ${event.suiteName}`);
        break;
      case "test_start":
        totalTests++;
        console.log(`Running: ${event.testName}`);
        break;
      case "test_complete":
        completedTests++;
        const status = event.passed ? "✅ PASS" : "❌ FAIL";
        const progress = `[${completedTests}/${totalTests}]`;
        console.log(
          `  ${status} ${progress} ${event.testName} (${event.duration.toFixed(2)}ms)`,
        );
        break;
      case "suite_complete":
        console.log(`\nSuite complete: ${event.suiteName}`);
        console.log(`Passed: ${event.passed} | Failed: ${event.failed}`);
        break;
    }
  },
});

const { describe, expect, test, afterAll, beforeAll, logOutputs, logFeedback } =
  bt;

beforeAll(async () => {
  _exportsForTestingOnly.setInitialTestState();
  await login({
    apiKey: process.env.BRAINTRUST_API_KEY,
  });
});

describe("Concurrent Execution: Mixed Workloads", () => {
  const openai = process.env.OPENAI_API_KEY
    ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
    : null;

  if (!process.env.OPENAI_API_KEY || !openai) {
    throw new Error(
      "OPENAI_API_KEY environment variable must be set to run LLM tests in examples/vitest/vitest-example.test.ts",
    );
  }

  // compute tasks
  test.concurrent("compute: math operations", async () => {
    const result = Math.pow(2, 10);
    logOutputs({ result, operation: "power" });
    logFeedback({ name: "correctness", score: 1.0 });
    expect(result).toBe(1024);
  });

  test.concurrent("compute: string processing", async () => {
    const result = "hello world".toUpperCase();
    logOutputs({ result, operation: "uppercase" });
    logFeedback({ name: "correctness", score: 1.0 });
    expect(result).toBe("HELLO WORLD");
  });

  // LLM tasks running concurrently
  test.concurrent(
    "llm: sentiment analysis",
    {
      input: { text: "This is amazing!" },
      expected: "positive",
      metadata: { task: "sentiment" },
    },
    async ({ input }) => {
      const typedInput = input as { text: string };
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Classify sentiment as positive/negative/neutral: "${typedInput.text}"`,
          },
        ],
        temperature: 0,
      });
      const output = response.choices[0]?.message?.content?.trim() || "";
      logOutputs({ output, tokens: response.usage });
      logFeedback({ name: "correctness", score: 1.0 });
      expect(output.length).toBeGreaterThan(0);
    },
  );

  test.concurrent(
    "llm: text generation",
    {
      input: { prompt: "Count to 5" },
      expected: "1, 2, 3, 4, 5",
      metadata: { task: "generation" },
    },
    async ({ input }) => {
      const typedInput = input as { prompt: string };
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: typedInput.prompt }],
        temperature: 0,
      });
      const output = response.choices[0]?.message?.content?.trim() || "";
      logOutputs({ output, tokens: response.usage });
      logFeedback({ name: "correctness", score: 1.0 });
      expect(output.length).toBeGreaterThan(0);
    },
  );

  // compute + LLM running concurrently
  test.concurrent("mixed: compute task", async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    logOutputs({ type: "compute", duration: 100 });
    expect(true).toBe(true);
  });
  test.concurrent("mixed: llm task", async () => {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say hi" }],
      temperature: 0,
    });
    logOutputs({
      type: "llm",
      output: response.choices[0]?.message?.content,
    });
    expect(response.choices[0]).toBeDefined();
  });
});

describe("Nested LLM Workflow", () => {
  const openai = process.env.OPENAI_API_KEY
    ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
    : null;

  if (!openai) {
    test("OPENAI_API_KEY required", () => {
      throw new Error(
        "OPENAI_API_KEY environment variable must be set to run LLM workflow tests",
      );
    });
    return;
  }

  test("extract key points", async () => {
    const text =
      "The quick brown fox jumps over the lazy dog. This sentence contains every letter.";
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: `Extract key points from: "${text}"`,
        },
      ],
      temperature: 0,
    });
    const output = response.choices[0]?.message?.content?.trim() || "";
    logOutputs({
      level: 1,
      task: "extraction",
      input: text,
      output,
      tokens: response.usage,
    });
    logFeedback({ name: "completeness", score: 1.0 });

    expect(output.length).toBeGreaterThan(0);
  });

  describe("Translation Tasks", () => {
    test("translate to Spanish", async () => {
      const text = "Hello, how are you?";
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Translate to Spanish: "${text}"`,
          },
        ],
        temperature: 0,
      });
      const output = response.choices[0]?.message?.content?.trim() || "";

      logOutputs({
        level: 2,
        task: "translation",
        source: text,
        target: "Spanish",
        output,
      });
      logFeedback({ name: "translation_quality", score: 0.95 });

      expect(output.length).toBeGreaterThan(0);
    });

    test("translate to French", async () => {
      const text = "Hello, how are you?";
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Translate to French: "${text}"`,
          },
        ],
        temperature: 0,
      });
      const output = response.choices[0]?.message?.content?.trim() || "";

      logOutputs({
        level: 2,
        task: "translation",
        source: text,
        target: "French",
        output,
      });
      logFeedback({ name: "translation_quality", score: 0.93 });

      expect(output.length).toBeGreaterThan(0);
    });

    describe("Translation Quality Checks", () => {
      test("check grammar accuracy", async () => {
        const translatedText = "Hola, ¿cómo estás?";
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: `Rate the grammar quality (0-1) of this Spanish text: "${translatedText}"`,
            },
          ],
          temperature: 0,
        });
        const output = response.choices[0]?.message?.content?.trim() || "";

        logOutputs({
          level: 3,
          task: "validation",
          check: "grammar",
          text: translatedText,
          assessment: output,
        });
        logFeedback({ name: "grammar_score", score: 0.98 });

        expect(output.length).toBeGreaterThan(0);
      });

      test("check naturalness", async () => {
        const translatedText = "Hola, ¿cómo estás?";
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: `Rate how natural (0-1) this Spanish phrase sounds: "${translatedText}"`,
            },
          ],
          temperature: 0,
        });
        const output = response.choices[0]?.message?.content?.trim() || "";

        logOutputs({
          level: 3,
          task: "validation",
          check: "naturalness",
          text: translatedText,
          assessment: output,
        });
        logFeedback({ name: "naturalness_score", score: 0.95 });

        expect(output.length).toBeGreaterThan(0);
      });
    });

    test("finalize translations", async () => {
      logOutputs({
        level: 2,
        task: "finalization",
        status: "All translations validated and approved",
      });
      logFeedback({ name: "workflow_completion", score: 1.0 });
      expect(true).toBe(true);
    });
  });

  describe("Summarization Tasks", () => {
    test("create brief summary", async () => {
      const longText =
        "Artificial intelligence and machine learning are transforming industries worldwide. Companies are using AI to improve customer service, automate processes, and gain insights from data. The technology is advancing rapidly with new breakthroughs happening regularly.";
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Summarize in one sentence: "${longText}"`,
          },
        ],
        temperature: 0,
      });
      const output = response.choices[0]?.message?.content?.trim() || "";

      logOutputs({
        level: 2,
        task: "summarization",
        type: "brief",
        output,
        reduction: `${longText.length} → ${output.length} chars`,
      });
      logFeedback({ name: "conciseness", score: 0.9 });

      expect(output.length).toBeGreaterThan(0);
      expect(output.length).toBeLessThan(longText.length);
    });

    test("extract key insights", async () => {
      const longText =
        "Recent studies show that remote work increases productivity by 13% on average. Employees report better work-life balance and reduced commute stress. However, companies face challenges with communication and team cohesion in remote settings.";
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `List 3 key insights from: "${longText}"`,
          },
        ],
        temperature: 0,
      });
      const output = response.choices[0]?.message?.content?.trim() || "";

      logOutputs({
        level: 2,
        task: "summarization",
        type: "insights",
        output,
      });
      logFeedback({ name: "relevance", score: 0.88 });

      expect(output.length).toBeGreaterThan(0);
    });
  });

  test("generate workflow report", async () => {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content:
            "Generate a brief report: Completed text processing workflow with translation and summarization.",
        },
      ],
      temperature: 0,
    });
    const output = response.choices[0]?.message?.content?.trim() || "";
    logOutputs({
      level: 1,
      task: "reporting",
      workflow: "complete",
      report: output,
    });
    logFeedback({ name: "workflow_success", score: 1.0 });

    expect(output.length).toBeGreaterThan(0);
  });
});

describe("Basic Test with Input/Expected", () => {
  const openai = process.env.OPENAI_API_KEY
    ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
    : null;

  if (!openai) {
    test("OPENAI_API_KEY required", () => {
      throw new Error(
        "OPENAI_API_KEY environment variable must be set to run basic examples",
      );
    });
    return;
  }

  // Simplest usage: Just input and expected
  test(
    "basic translation test",
    {
      input: { text: "Hello", target_lang: "Spanish" },
      expected: "Hola",
    },
    async ({ input }) => {
      const typedInput = input as { text: string; target_lang: string };
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Translate "${typedInput.text}" to ${typedInput.target_lang}. Respond with ONLY the translation.`,
          },
        ],
        temperature: 0,
      });

      const translation = response.choices[0]?.message?.content?.trim() || "";
      console.log(`\n📝 Translation: "${translation}"`);

      // Return the result for potential scorers
      return translation;
    },
  );
});

describe("Inline Data with Auto-Expansion", () => {
  const openai = process.env.OPENAI_API_KEY
    ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
    : null;

  if (!openai) {
    test("OPENAI_API_KEY required", () => {
      throw new Error(
        "OPENAI_API_KEY environment variable must be set to run inline data examples",
      );
    });
    return;
  }

  // Using inline data - automatically creates 3 separate tests
  test(
    "translate with inline dataset",
    {
      data: [
        {
          input: { text: "Hello", target_lang: "Spanish" },
          expected: "Hola",
          metadata: { difficulty: "easy" },
        },
        {
          input: { text: "Good morning", target_lang: "Spanish" },
          expected: "Buenos días",
          metadata: { difficulty: "easy" },
        },
        {
          input: { text: "Thank you very much", target_lang: "Spanish" },
          expected: "Muchas gracias",
          metadata: { difficulty: "medium" },
        },
      ],
      scorers: [
        // Custom scorer for word overlap
        ({ output, expected }) => {
          const outputStr = (output as string).toLowerCase().trim();
          const expectedStr = (expected as string).toLowerCase().trim();
          const outputWords = new Set(outputStr.split(" "));
          const expectedWords = expectedStr.split(" ");
          const matches = expectedWords.filter((w) =>
            outputWords.has(w),
          ).length;
          return {
            name: "word_overlap",
            score: matches / expectedWords.length,
            metadata: { matches, total: expectedWords.length },
          };
        },
      ],
    },
    async ({ input, expected }) => {
      const typedInput = input as { text: string; target_lang: string };

      console.log(
        `\n📝 Translating: "${typedInput.text}" to ${typedInput.target_lang}`,
      );

      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Translate "${typedInput.text}" to ${typedInput.target_lang}. Respond with ONLY the translation.`,
          },
        ],
        temperature: 0,
      });

      const translation = response.choices[0]?.message?.content?.trim() || "";
      console.log(`   Translation: "${translation}" (expected: "${expected}")`);

      // Return the translation - scorers will automatically evaluate it
      return translation;
    },
  );
});

describe("Basic Scorer Usage", () => {
  const openai = process.env.OPENAI_API_KEY
    ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
    : null;

  if (!openai) {
    test("OPENAI_API_KEY required", () => {
      throw new Error(
        "OPENAI_API_KEY environment variable must be set to run scorer examples",
      );
    });
    return;
  }

  // Single test with a simple inline scorer
  test(
    "translation with simple scorer",
    {
      input: { text: "Hello", target_lang: "Spanish" },
      expected: "Hola",
      scorers: [
        ({ output, expected }) => ({
          name: "exact_match",
          score:
            (output as string).toLowerCase().trim() ===
            (expected as string).toLowerCase().trim()
              ? 1
              : 0,
        }),
      ],
    },
    async ({ input }) => {
      const typedInput = input as { text: string; target_lang: string };
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Translate "${typedInput.text}" to ${typedInput.target_lang}. Respond with ONLY the translation.`,
          },
        ],
        temperature: 0,
      });

      const translation = response.choices[0]?.message?.content?.trim() || "";
      console.log(`\n🔤 Translation: "${translation}"`);

      // Return value becomes "output" for scorers
      return translation;
    },
  );
});

// Module-level: Create and load dataset before describe blocks
// This ensures the data is available at test registration time
const translationDataset = await (async () => {
  console.log("\n📊 Creating translation dataset...");

  // Use unique dataset name per run to avoid accumulation
  const datasetName = `translation-examples-${Date.now()}`;

  const dataset = initDataset({
    project: "example-vitest",
    dataset: datasetName,
    description: "Example translation test cases",
  });

  // Insert sample translation pairs
  const examples = [
    {
      input: { text: "Hello", target_lang: "Spanish" },
      expected: "Hola",
      metadata: { difficulty: "easy" },
    },
    {
      input: { text: "Good morning", target_lang: "Spanish" },
      expected: "Buenos días",
      metadata: { difficulty: "easy" },
    },
    {
      input: { text: "Thank you very much", target_lang: "Spanish" },
      expected: "Muchas gracias",
      metadata: { difficulty: "medium" },
    },
  ];

  for (const example of examples) {
    dataset.insert({
      input: example.input,
      expected: example.expected,
      metadata: example.metadata,
    });
  }

  await dataset.flush();
  console.log(`✅ Created dataset with ${examples.length} examples`);

  // Load and return the dataset records
  console.log("📥 Loading dataset from Braintrust...");
  const loaded = await bt.loadDataset({
    project: "example-vitest",
    dataset: datasetName,
  });
  console.log(`✅ Loaded ${loaded.length} test cases from dataset`);

  return loaded;
})();

describe("Loading Datasets from Braintrust", () => {
  const openai = process.env.OPENAI_API_KEY
    ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
    : null;

  if (!openai) {
    test("OPENAI_API_KEY required", () => {
      throw new Error(
        "OPENAI_API_KEY environment variable must be set to run dataset examples",
      );
    });
    return;
  }

  // Use the module-level loaded dataset with the data field + scorers
  test(
    "translate using loaded dataset",
    {
      data: translationDataset,
      scorers: [
        // Exact match scorer
        ({ output, expected }) => ({
          name: "exact_match",
          score:
            (output as string).toLowerCase().trim() ===
            (expected as string).toLowerCase().trim()
              ? 1
              : 0,
        }),
        // Word overlap scorer
        ({ output, expected }) => {
          const outputStr = (output as string).toLowerCase().trim();
          const expectedStr = (expected as string).toLowerCase().trim();
          const outputWords = new Set(outputStr.split(" "));
          const expectedWords = expectedStr.split(" ");
          const matches = expectedWords.filter((w) =>
            outputWords.has(w),
          ).length;
          return {
            name: "word_overlap",
            score: matches / expectedWords.length,
            metadata: { matches, total: expectedWords.length },
          };
        },
      ],
    },
    async ({ input, expected }) => {
      const typedInput = input as { text: string; target_lang: string };

      console.log(
        `\n📝 Translating: "${typedInput.text}" to ${typedInput.target_lang}`,
      );

      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Translate "${typedInput.text}" to ${typedInput.target_lang}. Respond with ONLY the translation.`,
          },
        ],
        temperature: 0,
      });

      const translation = response.choices[0]?.message?.content?.trim() || "";
      console.log(`   Translation: "${translation}" (expected: "${expected}")`);

      // Return the translation - scorers will automatically evaluate it
      return translation;
    },
  );
});

describe("Combining Inline Data + Multiple Scorers", () => {
  const openai = process.env.OPENAI_API_KEY
    ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
    : null;

  if (!openai) {
    test("OPENAI_API_KEY required", () => {
      throw new Error(
        "OPENAI_API_KEY environment variable must be set to run combined examples",
      );
    });
    return;
  }

  // Inline data with scorers - demonstrates auto-expansion + auto-scoring
  test(
    "math operations with accuracy scoring",
    {
      data: [
        { input: { num: 5 }, expected: 25 },
        { input: { num: 7 }, expected: 49 },
        { input: { num: 10 }, expected: 100 },
      ],
      scorers: [
        ({ output, expected }) => ({
          name: "accuracy",
          score: output === expected ? 1 : 0,
        }),
      ],
    },
    async ({ input }) => {
      const typedInput = input as { num: number };
      const result = typedInput.num * typedInput.num;
      console.log(`\n🔢 Square of ${typedInput.num} = ${result}`);
      return result;
    },
  );
});

describe("Complex Evaluation with Multiple Metrics", () => {
  const openai = process.env.OPENAI_API_KEY
    ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
    : null;

  if (!openai) {
    test("OPENAI_API_KEY required", () => {
      throw new Error(
        "OPENAI_API_KEY environment variable must be set to run scorer examples",
      );
    });
    return;
  }

  test(
    "translation with multiple custom scorers",
    {
      input: { text: "Hello world", target_lang: "Spanish" },
      expected: "Hola mundo",
      scorers: [
        // Custom scorer for string similarity (simple version)
        ({ output, expected }) => {
          const outputStr = (output as string).toLowerCase().trim();
          const expectedStr = (expected as string).toLowerCase().trim();
          // Simple word overlap score
          const outputWords = new Set(outputStr.split(" "));
          const expectedWords = expectedStr.split(" ");
          const matches = expectedWords.filter((w) =>
            outputWords.has(w),
          ).length;
          return {
            name: "word_overlap",
            score: matches / expectedWords.length,
            metadata: { matches, total: expectedWords.length },
          };
        },
        // Add custom scorer for exact match
        ({ output, expected }) => ({
          name: "exact_match",
          score:
            (output as string).toLowerCase().trim() ===
            (expected as string).toLowerCase()
              ? 1
              : 0,
        }),
      ],
    },
    async ({ input }) => {
      const typedInput = input as { text: string; target_lang: string };
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Translate "${typedInput.text}" to ${typedInput.target_lang}. Respond with ONLY the translation.`,
          },
        ],
        temperature: 0,
      });

      const translation = response.choices[0]?.message?.content?.trim() || "";
      console.log(`\n🔤 Translation: "${typedInput.text}" → "${translation}"`);

      // Return the translation - this becomes the "output" for scorers
      return translation;
    },
  );

  test(
    "sentiment analysis with multiple scorers",
    {
      input: { text: "This product is amazing and I love it!" },
      expected: "positive",
      scorers: [
        // Custom scorer for sentiment accuracy
        ({ output, expected }) => ({
          name: "sentiment_accuracy",
          score: (output as string).toLowerCase().includes(expected as string)
            ? 1
            : 0,
          metadata: { output_sentiment: output },
        }),
        // Custom scorer for response length
        ({ output }) => ({
          name: "conciseness",
          score: (output as string).length < 20 ? 1 : 0.7,
          metadata: { output_length: (output as string).length },
        }),
      ],
    },
    async ({ input }) => {
      const typedInput = input as { text: string };
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Classify the sentiment of this text as "positive", "negative", or "neutral": "${typedInput.text}"`,
          },
        ],
        temperature: 0,
      });

      const sentiment = response.choices[0]?.message?.content?.trim() || "";
      console.log(`\n😊 Sentiment: "${sentiment}"`);

      return sentiment;
    },
  );
});
