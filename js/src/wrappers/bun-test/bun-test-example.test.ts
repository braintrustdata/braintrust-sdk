import { test, describe, afterAll, beforeAll } from "bun:test";
import { currentSpan } from "../../logger";
import { initBunTestSuite } from "./suite";
import {
  setupBunTestEnv,
  teardownBunTestEnv,
  createTestInitExperiment,
} from "./test-helpers";

let moduleBackgroundLogger: Awaited<ReturnType<typeof setupBunTestEnv>>;
beforeAll(async () => {
  moduleBackgroundLogger = await setupBunTestEnv();
});

describe("Bun Test Suite Example", () => {
  const suite = initBunTestSuite({
    projectName: "bun-test-example",
    displaySummary: false,
    afterAll,
    test,
    _initExperiment: createTestInitExperiment(),
    onProgress: (event) => {
      if (event.type === "test_complete") {
        console.log(
          `  ${event.testName} (${event.duration.toFixed(2)}ms) - ${event.passed ? "PASSED" : "FAILED"}`,
        );
      }
    },
  });

  // Basic test with suite.test()
  suite.test(
    "basic addition",
    { input: { a: 2, b: 2 }, expected: 4 },
    async ({ input }) => {
      const { a, b } = input as { a: number; b: number };
      return a + b;
    },
  );

  // Test with metadata and tags
  suite.test(
    "multiplication with metadata",
    {
      input: { a: 3, b: 4 },
      expected: 12,
      metadata: { category: "arithmetic", difficulty: "easy" },
      tags: ["math", "multiplication"],
    },
    async ({ input }) => {
      const { a, b } = input as { a: number; b: number };
      return a * b;
    },
  );

  // Test with scorers
  suite.test(
    "string transformation with scorers",
    {
      input: "hello world",
      expected: "HELLO WORLD",
      scorers: [
        ({ output, expected }) => ({
          name: "exact_match",
          score: output === expected ? 1 : 0,
        }),
        ({ output }) => ({
          name: "is_uppercase",
          score:
            typeof output === "string" && output === output.toUpperCase()
              ? 1
              : 0,
        }),
      ],
    },
    async ({ input }) => {
      return (input as string).toUpperCase();
    },
  );

  // Data expansion with a loop
  const translationData = [
    { input: { text: "hello" }, expected: "hola" },
    { input: { text: "goodbye" }, expected: "adiós" },
    { input: { text: "thanks" }, expected: "gracias" },
  ];

  for (const [i, record] of translationData.entries()) {
    suite.test(
      `translation [${i}]`,
      {
        input: record.input,
        expected: record.expected,
        scorers: [
          ({ output, expected }) => ({
            name: "exact_match",
            score: output === expected ? 1 : 0,
          }),
        ],
      },
      async ({ input }) => {
        const translations: Record<string, string> = {
          hello: "hola",
          goodbye: "adiós",
          thanks: "gracias",
        };
        return translations[(input as any).text] || "unknown";
      },
    );
  }

  // Test using currentSpan() for custom logging
  suite.test(
    "custom outputs and feedback",
    { input: { query: "test query" } },
    async ({ input }) => {
      const result = `processed: ${(input as any).query}`;
      currentSpan().log({
        output: { processed_query: result, model: "test-model" },
        scores: { relevance: 0.9 },
        metadata: { evaluator: "human" },
      });
      return result;
    },
  );
});

afterAll(async () => {
  await moduleBackgroundLogger.flush();
  const spans = await moduleBackgroundLogger.drain();
  console.log(`  Example tests captured ${spans.length} spans`);

  teardownBunTestEnv();
});
