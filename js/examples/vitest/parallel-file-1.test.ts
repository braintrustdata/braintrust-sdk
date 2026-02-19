import { test, describe, expect, afterAll, beforeAll } from "vitest";
import { configureNode } from "../../src/node";
import { wrapVitest } from "../../src/wrappers/vitest/index";
import { _exportsForTestingOnly, login } from "../../src/logger";
import { wrapOpenAI } from "../../src/wrappers/oai";
import OpenAI from "openai";

configureNode();

// Initialize Braintrust state and login with real credentials from environment
beforeAll(async () => {
  _exportsForTestingOnly.setInitialTestState();
  await login({
    apiKey: process.env.BRAINTRUST_API_KEY,
  });
});

const bt = wrapVitest(
  { test, describe, expect, afterAll },
  {
    projectName: "parallel-file-1",
    displaySummary: true,
  },
);

const openai = process.env.OPENAI_API_KEY
  ? wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
  : null;

if (!process.env.OPENAI_API_KEY || !openai) {
  throw new Error(
    "OPENAI_API_KEY environment variable must be set to run LLM tests in examples/vitest/parallel-file-1.test.ts",
  );
}

// =============================================================================
// FILE 1: Math Operations
// =============================================================================
// This file runs in parallel with other test files (file-level parallelism).
// Vitest runs each test file in a separate worker thread by default.

bt.describe("File 1: Math Operations Suite", () => {
  bt.test("addition operations", async () => {
    console.log("\n[FILE 1] Running: addition operations");
    const result = 10 + 20;

    bt.logOutputs({
      file: "parallel-file-1",
      operation: "addition",
      result,
    });
    bt.logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe(30);
  });

  bt.test("multiplication operations", async () => {
    console.log("[FILE 1] Running: multiplication operations");
    const result = 5 * 6;

    bt.logOutputs({
      file: "parallel-file-1",
      operation: "multiplication",
      result,
    });
    bt.logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe(30);
  });

  bt.test("division operations", async () => {
    console.log("[FILE 1] Running: division operations");
    const result = 100 / 4;

    bt.logOutputs({
      file: "parallel-file-1",
      operation: "division",
      result,
    });
    bt.logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe(25);
  });

  // Test-level concurrency within this file
  bt.test.concurrent("concurrent: power operation", async () => {
    console.log("[FILE 1] Running: concurrent power operation");
    const result = Math.pow(2, 8);

    bt.logOutputs({
      file: "parallel-file-1",
      operation: "power",
      result,
      concurrent: true,
    });
    bt.logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe(256);
  });

  bt.test.concurrent("concurrent: square root operation", async () => {
    console.log("[FILE 1] Running: concurrent square root operation");
    const result = Math.sqrt(144);

    bt.logOutputs({
      file: "parallel-file-1",
      operation: "sqrt",
      result,
      concurrent: true,
    });
    bt.logFeedback({ name: "correctness", score: 1.0 });

    expect(result).toBe(12);
  });

  bt.test.concurrent("llm: simple generation", async () => {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say hi" }],
      temperature: 0,
    });
    const output = response.choices?.[0]?.message?.content?.trim() || "";
    bt.logOutputs({ output });
    bt.logFeedback({ name: "correctness", score: output.length ? 1.0 : 0.0 });
    expect(output.length).toBeGreaterThan(0);
  });
});
