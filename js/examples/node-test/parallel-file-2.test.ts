/**
 * Parallel File 2: String + LLM Operations
 *
 * This file runs in parallel with parallel-file-1.test.ts
 * Each file has its own suite/experiment.
 */

import { test, describe, after } from "node:test";
import { configureNode } from "../../src/node";
import { initNodeTestSuite } from "../../src/wrappers/node-test/index";
import { _exportsForTestingOnly, login, currentSpan } from "../../src/logger";
import { wrapOpenAI } from "../../src/wrappers/oai";
import OpenAI from "openai";

configureNode();

_exportsForTestingOnly.setInitialTestState();
await login({ apiKey: process.env.BRAINTRUST_API_KEY });

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY environment variable must be set to run examples/node-test/parallel-file-2.test.ts",
  );
}

const openai = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

describe("File 2: String Operations Suite", () => {
  const suite = initNodeTestSuite({
    projectName: "parallel-file-2-node-test",
    after,
  });

  // String tasks
  test(
    "uppercase transformation",
    suite.eval(
      {
        input: { text: "hello world" },
        expected: "HELLO WORLD",
        scorers: [
          ({ output, expected }) => ({
            name: "correctness",
            score: output === expected ? 1 : 0,
          }),
        ],
      },
      async ({ input }) => {
        return (input as { text: string }).text.toUpperCase();
      },
    ),
  );

  test(
    "string replace",
    suite.eval(
      {
        input: { text: "Hello World", find: "World", replace: "Node" },
        expected: "Hello Node",
        scorers: [
          ({ output, expected }) => ({
            name: "correctness",
            score: output === expected ? 1 : 0,
          }),
        ],
      },
      async ({ input }) => {
        const { text, find, replace } = input as {
          text: string;
          find: string;
          replace: string;
        };
        return text.replace(find, replace);
      },
    ),
  );

  test(
    "string split",
    suite.eval(
      {
        input: { text: "a,b,c,d", delimiter: "," },
        expected: ["a", "b", "c", "d"],
        scorers: [
          ({ output, expected }) => ({
            name: "correctness",
            score: JSON.stringify(output) === JSON.stringify(expected) ? 1 : 0,
          }),
        ],
      },
      async ({ input }) => {
        const { text, delimiter } = input as {
          text: string;
          delimiter: string;
        };
        return text.split(delimiter);
      },
    ),
  );

  // LLM task
  test(
    "llm: sentiment quick",
    suite.eval(
      {
        input: { text: "I love it" },
        expected: "positive",
        metadata: { task: "sentiment" },
      },
      async ({ input }) => {
        const { text } = input as { text: string };
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: `Is "${text}" positive or negative? Answer with one word.`,
            },
          ],
          temperature: 0,
        });
        const output = response.choices[0]?.message?.content?.trim() || "";
        currentSpan().log({
          output: { output },
          scores: {
            correctness: output.toLowerCase().includes("positive") ? 1 : 0,
          },
        });
        return output;
      },
    ),
  );
});
