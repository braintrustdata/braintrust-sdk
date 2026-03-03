/**
 * Bun Test Runner + Braintrust Example
 *
 * Demonstrates using initBunTestSuite to track test results as
 * Braintrust experiments using the Bun test runner.
 *
 * Run with: bun test
 * Requires: BRAINTRUST_API_KEY and OPENAI_API_KEY environment variables
 */

import { test, describe, afterAll } from "bun:test";
import { configureNode } from "../../src/node";
import { initBunTestSuite } from "../../src/wrappers/bun-test/index";
import { _exportsForTestingOnly, login, currentSpan } from "../../src/logger";
import { wrapOpenAI } from "../../src/wrappers/oai";
import OpenAI from "openai";

configureNode();

_exportsForTestingOnly.setInitialTestState();
await login({ apiKey: process.env.BRAINTRUST_API_KEY });

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY environment variable must be set to run examples/bun-test/bun-test-example.test.ts",
  );
}

const openai = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// ============================================================
// Basic Usage — scorers, data expansion, logging
// ============================================================

describe("Translation Evaluation", () => {
  const suite = initBunTestSuite({
    projectName: "example-bun-test",
    afterAll,
    test,
  });

  // --- Single test with input/expected and a scorer ---

  suite.test(
    "basic translation test",
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
    suite.test(
      `translation [${i}]: "${record.input.text}" → ${record.input.targetLang}`,
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
    );
  }

  // --- currentSpan() for custom logging ---

  suite.test(
    "translation with extra logging",
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

      currentSpan().log({
        output: { tokens: response.usage, model: response.model },
        scores: { human_quality: 0.95 },
        metadata: { evaluator: "example" },
      });

      return result;
    },
  );
});

// ============================================================
// Multiple Scorers
// ============================================================

describe("Multiple Scorers", () => {
  const suite = initBunTestSuite({
    projectName: "example-bun-test",
    afterAll,
    test,
  });

  suite.test(
    "translation with multiple custom scorers",
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
  );
});
