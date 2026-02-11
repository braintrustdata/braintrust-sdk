import * as vitest from "vitest";
import { configureNode } from "../../src/node";
import { wrapVitest } from "../../src/wrappers/vitest/index";
import { _exportsForTestingOnly, login } from "../../src/logger";
import { wrapOpenAI } from "../../src/wrappers/oai";
import OpenAI from "openai";

configureNode();

// Track test progress
let totalTests = 0;
let completedTests = 0;

// Create wrapped vitest with enhanced progress reporting
const { describe, expect, test, afterAll, beforeAll, logOutputs, logFeedback } =
  wrapVitest(vitest, {
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

  test("level 1: extract key points", async () => {
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

  // Level 2: Nested workflow - Translation
  describe("Level 2: Translation Tasks", () => {
    test("level 2: translate to Spanish", async () => {
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

    test("level 2: translate to French", async () => {
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

    // Level 3: Quality validation
    describe("Level 3: Translation Quality Checks", () => {
      test("level 3: check grammar accuracy", async () => {
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

      test("level 3: check naturalness", async () => {
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

    // Back to Level 2: Post-validation
    test("level 2: finalize translations", async () => {
      logOutputs({
        level: 2,
        task: "finalization",
        status: "All translations validated and approved",
      });
      logFeedback({ name: "workflow_completion", score: 1.0 });
      expect(true).toBe(true);
    });
  });

  // Sibling Level 2: Summarization workflow
  describe("Level 2: Summarization Tasks", () => {
    test("level 2: create brief summary", async () => {
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

    test("level 2: extract key insights", async () => {
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

  // Back to Level 1: Final report
  test("level 1: generate workflow report", async () => {
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
