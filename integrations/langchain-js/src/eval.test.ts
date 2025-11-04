import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { _exportsForTestingOnly, runEvaluator } from "braintrust";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { BraintrustCallbackHandler } from "./BraintrustCallbackHandler";
import { CHAT_MATH } from "./BraintrustCallbackHandler.fixtures";

import { server } from "./test/setup";

interface ProgressReporter {
  start: (name: string, total: number) => void;
  stop: () => void;
  increment: (name: string) => void;
}

class NoopProgressReporter implements ProgressReporter {
  public start() {}
  public stop() {}
  public increment() {}
}

describe("Eval with BraintrustCallbackHandler", () => {
  it("should handle concurrent eval tasks with proper span hierarchy", async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
    const memoryLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    const experiment = _exportsForTestingOnly.initTestExperiment(
      "langchain-concurrent-test",
    );

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json(CHAT_MATH);
      }),
    );

    const result = await runEvaluator(
      experiment,
      {
        projectName: "langchain-test",
        evalName: "concurrent-test",
        data: [
          { input: "test 1", expected: "output 1" },
          { input: "test 2", expected: "output 2" },
          { input: "test 3", expected: "output 3" },
        ],
        task: async (input, { span }) => {
          const prompt = ChatPromptTemplate.fromTemplate(`Process: {input}`);
          const model = new ChatOpenAI({
            model: "gpt-4o-mini-2024-07-18",
          });

          const chain = prompt.pipe(model);

          const message = await chain.invoke(
            { input },
            {
              callbacks: [
                new BraintrustCallbackHandler({
                  logger: span,
                }),
              ],
            },
          );

          return message.content;
        },
        scores: [() => ({ name: "test_score", score: 1 })],
        summarizeScores: false,
        // Not setting maxConcurrency, so tasks run concurrently by default
      },
      new NoopProgressReporter(),
      [],
      undefined,
    );

    await memoryLogger.flush();

    // Verify results
    expect(result.results).toHaveLength(3);
    expect(result.results[0].input).toBe("test 1");
    expect(result.results[1].input).toBe("test 2");
    expect(result.results[2].input).toBe("test 3");

    // Collect all spans from memory logger
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
    const allSpans = (await memoryLogger.drain()) as any[];

    expect(allSpans.length).toBeGreaterThan(0);

    // Find all task spans (from the Eval)
    const taskSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) =>
        s.span_attributes?.name === "task" &&
        s.span_attributes?.type === "task",
    );
    expect(taskSpans.length).toBeGreaterThanOrEqual(3);

    // Find all LLM spans (from ChatOpenAI calls logged by BraintrustCallbackHandler)
    const llmSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) =>
        s.span_attributes?.type === "llm" &&
        (s.span_attributes?.name?.includes("ChatOpenAI") ||
          s.span_attributes?.name?.includes("Chat Model")),
    );
    expect(llmSpans.length).toBeGreaterThanOrEqual(3);

    // Critical test: Each LLM span should have a parent
    // This verifies the fix - that LLM spans are properly attached to their task spans
    // even when running concurrently
    for (const llmSpan of llmSpans) {
      expect(llmSpan.span_parents).toBeDefined();
      expect(llmSpan.span_parents.length).toBeGreaterThan(0);

      // Find the parent span
      const parentSpanId = llmSpan.span_parents[0];
      const parentSpan = allSpans.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => s.span_id === parentSpanId,
      );

      // The parent should exist and not be orphaned
      expect(parentSpan).toBeDefined();

      // Verify the LLM span is not directly attached to the eval root
      // It should be under a task span or chain span
      expect(parentSpan!.span_attributes?.name).not.toBe("concurrent-test");
    }

    // Verify that each task span has children (LLM spans or chain spans)
    for (const taskSpan of taskSpans) {
      expect(taskSpan.span_id).toBeDefined();

      const childSpans = allSpans.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => s.span_parents?.includes(taskSpan.span_id),
      );

      // Each task should have at least one child (the chain or LLM call)
      expect(childSpans.length).toBeGreaterThan(0);
    }
  });

  it("should work with maxConcurrency: 1 (sequential)", async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
    const memoryLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    const experiment = _exportsForTestingOnly.initTestExperiment(
      "langchain-sequential-test",
    );

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json(CHAT_MATH);
      }),
    );

    const result = await runEvaluator(
      experiment,
      {
        projectName: "langchain-test",
        evalName: "sequential-test",
        data: [{ input: "test 1" }, { input: "test 2" }],
        task: async (input, { span }) => {
          const model = new ChatOpenAI({
            model: "gpt-4o-mini-2024-07-18",
          });

          const message = await model.invoke([input], {
            callbacks: [
              new BraintrustCallbackHandler({
                logger: span,
              }),
            ],
          });

          return message.content;
        },
        scores: [() => ({ name: "test_score", score: 1 })],
        summarizeScores: false,
        maxConcurrency: 1, // Sequential execution
      },
      new NoopProgressReporter(),
      [],
      undefined,
    );

    await memoryLogger.flush();

    expect(result.results).toHaveLength(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
    const allSpans = (await memoryLogger.drain()) as any[];

    expect(allSpans.length).toBeGreaterThan(0);

    const taskSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) =>
        s.span_attributes?.name === "task" &&
        s.span_attributes?.type === "task",
    );
    expect(taskSpans.length).toBeGreaterThanOrEqual(2);

    const llmSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.span_attributes?.type === "llm",
    );
    expect(llmSpans.length).toBeGreaterThanOrEqual(2);

    // Verify proper parent-child relationships even in sequential mode
    for (const llmSpan of llmSpans) {
      expect(llmSpan.span_parents).toBeDefined();
      expect(llmSpan.span_parents.length).toBeGreaterThan(0);
    }
  });

  it("should respect parent option over logger option", async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
    const memoryLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    const experiment = _exportsForTestingOnly.initTestExperiment(
      "langchain-parent-test",
    );

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json(CHAT_MATH);
      }),
    );

    const result = await runEvaluator(
      experiment,
      {
        projectName: "langchain-test",
        evalName: "parent-test",
        data: [{ input: "test 1" }, { input: "test 2" }],
        task: async (input, { span }) => {
          // Create a custom parent span
          const customParent = span.startSpan({
            name: "custom-parent",
            spanAttributes: { type: "function" },
          });

          const model = new ChatOpenAI({
            model: "gpt-4o-mini-2024-07-18",
          });

          // Use parent option instead of logger option
          const message = await model.invoke([input], {
            callbacks: [
              new BraintrustCallbackHandler({
                parent: customParent,
                logger: span, // This should be overridden by parent
              }),
            ],
          });

          customParent.end();
          return message.content;
        },
        scores: [() => ({ name: "test_score", score: 1 })],
        summarizeScores: false,
        maxConcurrency: 2,
      },
      new NoopProgressReporter(),
      [],
      undefined,
    );

    await memoryLogger.flush();

    expect(result.results).toHaveLength(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
    const allSpans = (await memoryLogger.drain()) as any[];

    expect(allSpans.length).toBeGreaterThan(0);

    // Find custom parent spans
    const customParentSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.span_attributes?.name === "custom-parent",
    );
    expect(customParentSpans.length).toBeGreaterThanOrEqual(2);

    // Find LLM spans
    const llmSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.span_attributes?.type === "llm",
    );
    expect(llmSpans.length).toBeGreaterThanOrEqual(2);

    // Critical test: LLM spans should be children of custom-parent, not task
    for (const llmSpan of llmSpans) {
      expect(llmSpan.span_parents).toBeDefined();
      expect(llmSpan.span_parents.length).toBeGreaterThan(0);

      // Trace up to find if it's under a custom-parent span
      let currentSpan = llmSpan;
      let foundCustomParent = false;
      let depth = 0;
      const maxDepth = 10;

      while (
        depth < maxDepth &&
        currentSpan.span_parents &&
        currentSpan.span_parents.length > 0
      ) {
        const parentId = currentSpan.span_parents[0];
        const parentSpan = allSpans.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (s: any) => s.span_id === parentId,
        );

        if (!parentSpan) break;

        if (parentSpan.span_attributes?.name === "custom-parent") {
          foundCustomParent = true;
          break;
        }

        currentSpan = parentSpan;
        depth++;
      }

      // Verify that parent option was respected
      expect(foundCustomParent).toBe(true);
    }
  });

  it("should handle parent as a function", async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
    const memoryLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    const experiment = _exportsForTestingOnly.initTestExperiment(
      "langchain-parent-function-test",
    );

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json(CHAT_MATH);
      }),
    );

    const result = await runEvaluator(
      experiment,
      {
        projectName: "langchain-test",
        evalName: "parent-function-test",
        data: [{ input: "test 1" }, { input: "test 2" }],
        task: async (input, { span }) => {
          // Create a custom parent span
          const customParent = span.startSpan({
            name: "custom-function-parent",
            spanAttributes: { type: "function" },
          });

          const model = new ChatOpenAI({
            model: "gpt-4o-mini-2024-07-18",
          });

          // Use parent as a function that returns the span
          const message = await model.invoke([input], {
            callbacks: [
              new BraintrustCallbackHandler({
                parent: () => customParent,
                logger: span, // This should be overridden by parent function
              }),
            ],
          });

          customParent.end();
          return message.content;
        },
        scores: [() => ({ name: "test_score", score: 1 })],
        summarizeScores: false,
        maxConcurrency: 2,
      },
      new NoopProgressReporter(),
      [],
      undefined,
    );

    await memoryLogger.flush();

    expect(result.results).toHaveLength(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
    const allSpans = (await memoryLogger.drain()) as any[];

    expect(allSpans.length).toBeGreaterThan(0);

    // Find custom parent spans
    const customParentSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.span_attributes?.name === "custom-function-parent",
    );
    expect(customParentSpans.length).toBeGreaterThanOrEqual(2);

    // Find LLM spans
    const llmSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.span_attributes?.type === "llm",
    );
    expect(llmSpans.length).toBeGreaterThanOrEqual(2);

    // Critical test: LLM spans should be children of custom-function-parent
    for (const llmSpan of llmSpans) {
      expect(llmSpan.span_parents).toBeDefined();
      expect(llmSpan.span_parents.length).toBeGreaterThan(0);

      // Trace up to find if it's under a custom-function-parent span
      let currentSpan = llmSpan;
      let foundCustomParent = false;
      let depth = 0;
      const maxDepth = 10;

      while (
        depth < maxDepth &&
        currentSpan.span_parents &&
        currentSpan.span_parents.length > 0
      ) {
        const parentId = currentSpan.span_parents[0];
        const parentSpan = allSpans.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (s: any) => s.span_id === parentId,
        );

        if (!parentSpan) break;

        if (parentSpan.span_attributes?.name === "custom-function-parent") {
          foundCustomParent = true;
          break;
        }

        currentSpan = parentSpan;
        depth++;
      }

      // Verify that parent function was called and respected
      expect(foundCustomParent).toBe(true);
    }
  });

  it("should work without explicit logger or parent in concurrent eval", async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
    const memoryLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    const experiment = _exportsForTestingOnly.initTestExperiment(
      "langchain-implicit-context-test",
    );

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json(CHAT_MATH);
      }),
    );

    const result = await runEvaluator(
      experiment,
      {
        projectName: "langchain-test",
        evalName: "implicit-context-test",
        data: [{ input: "test 1" }, { input: "test 2" }, { input: "test 3" }],
        task: async (input) => {
          const model = new ChatOpenAI({
            model: "gpt-4o-mini-2024-07-18",
          });

          // No explicit logger or parent - should use currentSpan() at operation time
          const message = await model.invoke([input], {
            callbacks: [new BraintrustCallbackHandler()],
          });

          return message.content;
        },
        scores: [() => ({ name: "test_score", score: 1 })],
        summarizeScores: false,
        // Not setting maxConcurrency, so tasks run concurrently
      },
      new NoopProgressReporter(),
      [],
      undefined,
    );

    await memoryLogger.flush();

    expect(result.results).toHaveLength(3);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
    const allSpans = (await memoryLogger.drain()) as any[];

    expect(allSpans.length).toBeGreaterThan(0);

    // Find task spans
    const taskSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) =>
        s.span_attributes?.name === "task" &&
        s.span_attributes?.type === "task",
    );
    expect(taskSpans.length).toBeGreaterThanOrEqual(3);

    // Find LLM spans
    const llmSpans = allSpans.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.span_attributes?.type === "llm",
    );
    expect(llmSpans.length).toBeGreaterThanOrEqual(3);

    // Critical test: Even without explicit logger/parent, each LLM span should be
    // attached to its corresponding task span (not all to the same one)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llmParentIds = llmSpans.map((s: any) => s.span_parents[0]);
    const uniqueParents = new Set(llmParentIds);

    // Each LLM should have a different parent (one per task)
    expect(uniqueParents.size).toBeGreaterThanOrEqual(3);

    // Verify each task has children
    for (const taskSpan of taskSpans) {
      const childSpans = allSpans.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => s.span_parents?.includes(taskSpan.span_id),
      );

      expect(childSpans.length).toBeGreaterThan(0);
    }
  });
});
