/**
 * Node.js Test Runner + Braintrust Example
 *
 * Demonstrates using initNodeTestSuite to track test results as
 * Braintrust experiments using the native Node.js test runner.
 */

import { test, describe, after } from "node:test";
import { configureNode } from "../../src/node";
import { initNodeTestSuite } from "../../src/wrappers/node-test/index";
import { _exportsForTestingOnly, login } from "../../src/logger";
import { wrapOpenAI } from "../../src/wrappers/oai";
import OpenAI from "openai";

configureNode();

_exportsForTestingOnly.setInitialTestState();
await login({ apiKey: process.env.BRAINTRUST_API_KEY });

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY environment variable must be set to run examples/node-test/node-test-example.test.ts",
  );
}

const openai = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// ============================================================
// Basic Usage — scorers, data expansion, logging
// ============================================================

describe("Translation Evaluation", () => {
  const suite = initNodeTestSuite({
    projectName: "example-node-test",
    after,
  });

  // --- Single test with input/expected and a scorer ---

  test(
    "basic translation test",
    suite.eval(
      {
        input: { text: "Hello", targetLang: "Spanish" },
        expected: "Hola",
        metadata: { difficulty: "easy" },
        tags: ["translation", "spanish"],
        scorers: [
          ({ output, expected }) => ({
            name: "exact_match",
            score:
              String(output).toLowerCase().trim() ===
              String(expected).toLowerCase().trim()
                ? 1
                : 0,
          }),
        ],
      },
      async ({ input }) => {
        const { text, targetLang } = input as {
          text: string;
          targetLang: string;
        };
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: `Translate "${text}" to ${targetLang}. Respond with ONLY the translation.`,
            },
          ],
          temperature: 0,
        });
        return response.choices[0]?.message?.content?.trim() || "";
      },
    ),
  );

  // --- Data expansion with a loop ---

  const translationCases = [
    {
      input: { text: "Good morning", targetLang: "Spanish" },
      expected: "Buenos días",
    },
    {
      input: { text: "Thank you very much", targetLang: "Spanish" },
      expected: "Muchas gracias",
    },
    {
      input: { text: "Goodbye", targetLang: "French" },
      expected: "Au revoir",
    },
  ];

  for (const [i, record] of translationCases.entries()) {
    test(
      `translation [${i}]: "${record.input.text}" → ${record.input.targetLang}`,
      suite.eval(
        {
          ...record,
          scorers: [
            ({ output, expected }) => {
              const outputStr = String(output).toLowerCase().trim();
              const expectedStr = String(expected).toLowerCase().trim();
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
        async ({ input }) => {
          const { text, targetLang } = input as {
            text: string;
            targetLang: string;
          };
          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "user",
                content: `Translate "${text}" to ${targetLang}. Respond with ONLY the translation.`,
              },
            ],
            temperature: 0,
          });
          return response.choices[0]?.message?.content?.trim() || "";
        },
      ),
    );
  }

  // --- logOutputs and logFeedback ---

  test(
    "translation with extra logging",
    suite.eval(
      {
        input: { text: "How are you?", targetLang: "Spanish" },
        expected: "¿Cómo estás?",
      },
      async ({ input }) => {
        const { text, targetLang } = input as {
          text: string;
          targetLang: string;
        };
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: `Translate "${text}" to ${targetLang}. Respond with ONLY the translation.`,
            },
          ],
          temperature: 0,
        });

        const result = response.choices[0]?.message?.content?.trim() || "";

        suite.logOutputs({
          tokens: response.usage,
          model: response.model,
        });
        suite.logFeedback({
          name: "human_quality",
          score: 0.95,
          metadata: { evaluator: "example" },
        });

        return result;
      },
    ),
  );
});

// ============================================================
// Nested Describes — share the same experiment
// ============================================================

describe("LLM Workflow", () => {
  const suite = initNodeTestSuite({
    projectName: "example-node-test",
    after,
  });

  test(
    "sentiment analysis",
    suite.eval(
      {
        input: { text: "This product is amazing and I love it!" },
        expected: "positive",
        metadata: { task: "sentiment" },
        scorers: [
          ({ output, expected }) => ({
            name: "sentiment_accuracy",
            score: String(output).toLowerCase().includes(String(expected))
              ? 1
              : 0,
          }),
        ],
      },
      async ({ input }) => {
        const { text } = input as { text: string };
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: `Classify the sentiment as "positive", "negative", or "neutral": "${text}"`,
            },
          ],
          temperature: 0,
        });
        return response.choices[0]?.message?.content?.trim() || "";
      },
    ),
  );

  describe("Summarization Tasks", () => {
    test(
      "create brief summary",
      suite.eval(
        {
          input: {
            text: "Artificial intelligence and machine learning are transforming industries worldwide. Companies are using AI to improve customer service, automate processes, and gain insights from data.",
          },
          metadata: { task: "summarization", type: "brief" },
        },
        async ({ input }) => {
          const { text } = input as { text: string };
          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "user",
                content: `Summarize in one sentence: "${text}"`,
              },
            ],
            temperature: 0,
          });

          const summary = response.choices[0]?.message?.content?.trim() || "";

          suite.logOutputs({
            reduction: `${text.length} → ${summary.length} chars`,
          });
          suite.logFeedback({ name: "conciseness", score: 0.9 });

          return summary;
        },
      ),
    );

    test(
      "extract key insights",
      suite.eval(
        {
          input: {
            text: "Recent studies show that remote work increases productivity by 13% on average. Employees report better work-life balance and reduced commute stress. However, companies face challenges with communication and team cohesion.",
          },
          metadata: { task: "summarization", type: "insights" },
        },
        async ({ input }) => {
          const { text } = input as { text: string };
          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "user",
                content: `List 3 key insights from: "${text}"`,
              },
            ],
            temperature: 0,
          });
          return response.choices[0]?.message?.content?.trim() || "";
        },
      ),
    );
  });
});

// ============================================================
// Multiple Scorers
// ============================================================

describe("Multiple Scorers", () => {
  const suite = initNodeTestSuite({
    projectName: "example-node-test",
    after,
  });

  test(
    "translation with multiple custom scorers",
    suite.eval(
      {
        input: { text: "Hello world", targetLang: "Spanish" },
        expected: "Hola mundo",
        scorers: [
          ({ output, expected }) => ({
            name: "exact_match",
            score:
              String(output).toLowerCase().trim() ===
              String(expected).toLowerCase().trim()
                ? 1
                : 0,
          }),
          ({ output, expected }) => {
            const outputWords = new Set(
              String(output).toLowerCase().trim().split(" "),
            );
            const expectedWords = String(expected)
              .toLowerCase()
              .trim()
              .split(" ");
            const matches = expectedWords.filter((w) =>
              outputWords.has(w),
            ).length;
            return {
              name: "word_overlap",
              score: matches / expectedWords.length,
              metadata: { matches, total: expectedWords.length },
            };
          },
          ({ output }) => ({
            name: "conciseness",
            score: String(output).length < 20 ? 1 : 0.7,
            metadata: { length: String(output).length },
          }),
        ],
      },
      async ({ input }) => {
        const { text, targetLang } = input as {
          text: string;
          targetLang: string;
        };
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: `Translate "${text}" to ${targetLang}. Respond with ONLY the translation.`,
            },
          ],
          temperature: 0,
        });
        return response.choices[0]?.message?.content?.trim() || "";
      },
    ),
  );
});
