import * as vitest from "vitest";
import { configureNode } from "../../src/node";
import { wrapVitest } from "../../src/wrappers/vitest/index";
import { _exportsForTestingOnly, login } from "../../src/logger";
import { wrapOpenAI } from "../../src/wrappers/oai";
import OpenAI from "openai";

configureNode();

const { describe, expect, test, beforeAll, afterAll, logOutputs, logFeedback } =
  wrapVitest(vitest, {
    projectName: "example-vitest",
    displaySummary: true,
  });

beforeAll(async () => {
  _exportsForTestingOnly.setInitialTestState();
  await login({
    apiKey: process.env.BRAINTRUST_API_KEY,
  });
});

const openai = process.env.OPENAI_API_KEY
  ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
  : null;

if (!process.env.OPENAI_API_KEY || !openai) {
  throw new Error(
    "OPENAI_API_KEY environment variable must be set to run LLM tests in examples/vitest/parallel-file-2.test.ts",
  );
}

// =============================================================================
// FILE 2: String Operations
// =============================================================================
// This file runs in parallel with other test files (file-level parallelism).
// Each file maintains its own isolated experiment context.

describe("File 2: String Operations Suite", () => {
  test("uppercase transformation", async () => {
    console.log("\n[FILE 2] Running: uppercase transformation");
    const result = "hello world".toUpperCase();

    logOutputs({
      file: "parallel-file-2",
      operation: "uppercase",
      result,
    });
    logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe("HELLO WORLD");
  });

  test("lowercase transformation", async () => {
    console.log("[FILE 2] Running: lowercase transformation");
    const result = "HELLO WORLD".toLowerCase();

    logOutputs({
      file: "parallel-file-2",
      operation: "lowercase",
      result,
    });
    logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe("hello world");
  });

  test("string concatenation", async () => {
    console.log("[FILE 2] Running: string concatenation");
    const result = "Hello" + " " + "World";

    logOutputs({
      file: "parallel-file-2",
      operation: "concatenation",
      result,
    });
    logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe("Hello World");
  });

  // Test-level concurrency within this file
  test.concurrent("concurrent: string replace", async () => {
    console.log("[FILE 2] Running: concurrent string replace");
    const result = "Hello World".replace("World", "Vitest");

    logOutputs({
      file: "parallel-file-2",
      operation: "replace",
      result,
      concurrent: true,
    });
    logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe("Hello Vitest");
  });

  test.concurrent("concurrent: string split", async () => {
    console.log("[FILE 2] Running: concurrent string split");
    const result = "a,b,c,d".split(",");

    logOutputs({
      file: "parallel-file-2",
      operation: "split",
      result,
      concurrent: true,
    });
    logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toEqual(["a", "b", "c", "d"]);
  });

  test.concurrent("llm: sentiment quick", async () => {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "user", content: "Is 'I love it' positive or negative?" },
      ],
      temperature: 0,
    });
    const output = response.choices?.[0]?.message?.content?.trim() || "";
    logOutputs({ output });
    logFeedback({ name: "correctness", score: output.length ? 1.0 : 0.0 });
    expect(output.length).toBeGreaterThan(0);
  });
});
