/**
 * Parallel File 1: Math + LLM Operations
 *
 * Each file has its own suite/experiment. Node's test runner handles
 * file-level parallelism automatically.
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
    "OPENAI_API_KEY environment variable must be set to run examples/node-test/parallel-file-1.test.ts",
  );
}

const openai = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

describe("File 1: Math Operations Suite", () => {
  const suite = initNodeTestSuite({
    projectName: "parallel-file-1-node-test",
    after,
  });

  // Compute tasks
  test(
    "compute: math operations",
    suite.eval(
      {
        input: { base: 2, exponent: 10 },
        expected: 1024,
        metadata: { operation: "power" },
        scorers: [
          ({ output, expected }) => ({
            name: "correctness",
            score: output === expected ? 1 : 0,
          }),
        ],
      },
      async ({ input }) => {
        const { base, exponent } = input as {
          base: number;
          exponent: number;
        };
        return Math.pow(base, exponent);
      },
    ),
  );

  test(
    "compute: string processing",
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

  // LLM tasks
  test(
    "llm: sentiment analysis",
    suite.eval(
      {
        input: { text: "This is amazing!" },
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
              content: `Classify sentiment as positive/negative/neutral: "${text}"`,
            },
          ],
          temperature: 0,
        });
        const output = response.choices[0]?.message?.content?.trim() || "";
        currentSpan().log({ output: { output, tokens: response.usage } });
        return output;
      },
    ),
  );

  test(
    "llm: text generation",
    suite.eval(
      {
        input: { prompt: "Count to 5" },
        expected: "1, 2, 3, 4, 5",
        metadata: { task: "generation" },
      },
      async ({ input }) => {
        const { prompt } = input as { prompt: string };
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
        });
        const output = response.choices[0]?.message?.content?.trim() || "";
        currentSpan().log({ output: { output, tokens: response.usage } });
        return output;
      },
    ),
  );
});
