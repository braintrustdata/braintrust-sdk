import {
  beforeAll,
  expect,
  describe,
  test,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  defaultErrorScoreHandler,
  EvalScorer,
  runEvaluator,
} from "./framework";
import { configureNode } from "./node";
import { BarProgressReporter, type ProgressReporter } from "./progress";
import { InternalAbortError } from "./util";

beforeAll(() => {
  configureNode();
});

class NoopProgressReporter implements ProgressReporter {
  public start() {}
  public stop() {}
  public increment() {}
}

test("meta (write) is passed to task", async () => {
  const metadata = {
    bar: "baz",
    foo: "bar",
  };

  const out = await runEvaluator(
    null,
    {
      projectName: "proj",
      evalName: "eval",
      data: [{ input: 1, metadata }],
      task: async (input: number, { meta }) => {
        meta({
          foo: "barbar",
        });
        return input * 2;
      },
      scores: [],
    },
    new NoopProgressReporter(),
    [],
    undefined,
  );

  // @ts-expect-error metadata is not typed if the experiment is missing
  expect(out.results[0].metadata).toEqual({
    bar: "baz",
    foo: "barbar",
  });
});

test("metadata (read/write) is passed to task", async () => {
  const metadata = {
    bar: "baz",
    foo: "bar",
  };

  let passedIn: Record<string, unknown> | null = null;

  const out = await runEvaluator(
    null,
    {
      projectName: "proj",
      evalName: "eval",
      data: [{ input: 1, metadata }],
      task: async (input: number, { metadata: m }) => {
        passedIn = { ...m };

        // modify the metadata object
        m.foo = "barbar";

        return input * 2;
      },
      scores: [],
    },
    new NoopProgressReporter(),
    [],
    undefined,
  );

  expect(passedIn).toEqual(metadata);

  // @ts-expect-error metadata is not typed if the experiment is missing
  expect(out.results[0].metadata).toEqual({
    bar: "baz",
    foo: "barbar",
  });
});

test("expected (read/write) is passed to task", async () => {
  const expected = {
    bar: "baz",
    foo: "bar",
  };

  let passedIn: Record<string, unknown> | null = null;

  const out = await runEvaluator(
    null,
    {
      projectName: "proj",
      evalName: "eval",
      data: [{ input: 1, expected }],
      task: async (input: number, { expected: e }) => {
        passedIn = { ...e };

        // modify the expected object
        e.foo = "barbar";

        return input * 2;
      },
      scores: [],
    },
    new NoopProgressReporter(),
    [],
    undefined,
  );

  expect(passedIn).toEqual({
    bar: "baz",
    foo: "bar",
  });

  // @ts-expect-error metadata is not typed if the experiment is missing
  expect(out.results[0].expected).toEqual({
    bar: "baz",
    foo: "barbar",
  });
});

function makeTestScorer(
  name: string,
  willError?: boolean,
): EvalScorer<any, any, any, any> {
  return () => {
    if (willError) {
      throw new Error("scorer errored");
    }
    return {
      name,
      score: 1,
    };
  };
}

describe("runEvaluator", () => {
  describe("errors", () => {
    test("task errors generate no scores", async () => {
      const out = await runEvaluator(
        null,
        {
          projectName: "proj",
          evalName: "eval",
          data: [{ input: 1 }],
          task: async () => {
            throw new Error("test error");
          },
          scores: Array.from({ length: 3 }, (_, i) =>
            makeTestScorer(`scorer_${i}`),
          ),
        },
        new NoopProgressReporter(),
        [],
        undefined,
      );

      expect(out.results.every((r) => Object.keys(r.scores).length === 0)).toBe(
        true,
      );
    });

    describe("errorScoreHandler", () => {
      describe("default function", () => {
        test("task errors generate 0 scores for all scorers", async () => {
          const out = await runEvaluator(
            null,
            {
              projectName: "proj",
              evalName: "eval",
              data: [{ input: 1 }],
              task: async () => {
                throw new Error("test error");
              },
              scores: Array.from({ length: 3 }, (_, i) =>
                makeTestScorer(`scorer_${i}`),
              ),
              errorScoreHandler: defaultErrorScoreHandler,
            },
            new NoopProgressReporter(),
            [],
            undefined,
          );

          expect(
            out.results.every(
              (r) =>
                Object.keys(r.scores).length === 3 &&
                Object.values(r.scores).every((v) => v === 0),
            ),
          ).toBe(true);
        });

        test("scorer errors generate 0 scores for all errored scorers", async () => {
          const out = await runEvaluator(
            null,
            {
              projectName: "proj",
              evalName: "eval",
              data: [{ input: 1 }],
              task: async () => {
                return "valid output";
              },
              scores: Array.from({ length: 3 }, (_, i) =>
                makeTestScorer(`scorer_${i}`, i === 0),
              ),
              errorScoreHandler: defaultErrorScoreHandler,
            },
            new NoopProgressReporter(),
            [],
            undefined,
          );

          expect(
            out.results.every(
              (r) =>
                Object.keys(r.scores).length === 3 &&
                r.scores.scorer_0 === 0 &&
                r.scores.scorer_1 === 1 &&
                r.scores.scorer_2 === 1,
            ),
          ).toBe(true);
        });
      });

      describe("custom function", () => {
        test("noop function generates no scores", async () => {
          const out = await runEvaluator(
            null,
            {
              projectName: "proj",
              evalName: "eval",
              data: [{ input: 1 }],
              task: async () => {
                throw new Error("test error");
              },
              scores: Array.from({ length: 3 }, (_, i) =>
                makeTestScorer(`scorer_${i}`),
              ),
              errorScoreHandler: () => undefined,
            },
            new NoopProgressReporter(),
            [],
            undefined,
          );

          expect(
            out.results.every((r) => Object.keys(r.scores).length === 0),
          ).toBe(true);
        });

        test("function can generate arbitrary scores", async () => {
          const out = await runEvaluator(
            null,
            {
              projectName: "proj",
              evalName: "eval",
              data: [{ input: 1 }],
              task: async () => {
                throw new Error("test error");
              },
              scores: Array.from({ length: 3 }, (_, i) =>
                makeTestScorer(`scorer_${i}`),
              ),
              errorScoreHandler: () => ({ error_score: 1 }),
            },
            new BarProgressReporter(),
            [],
            undefined,
          );

          expect(
            out.results.every(
              (r) =>
                Object.keys(r.scores).length === 1 &&
                r.scores.error_score === 1,
            ),
          ).toBe(true);
        });
      });
    });
  });

  describe("aborts", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    test("runEvaluator rejects on timeout and kills remaining tasks", async () => {
      const taskStarts: Set<number> = new Set();
      const taskCompletions: Set<number> = new Set();

      const runExpect = expect(
        runEvaluator(
          null,
          {
            projectName: "proj",
            evalName: "eval",
            data: Array.from({ length: 10 }, (_, i) => ({
              input: i,
              expected: i * 2,
            })),
            task: async (input: number) => {
              taskStarts.add(input);
              if (input > 2) {
                await new Promise((r) => setTimeout(r, 100));
              }
              taskCompletions.add(input);
              return input * 2;
            },
            scores: [],
            timeout: 10,
            maxConcurrency: 1,
          },
          new NoopProgressReporter(),
          [],
          undefined,
        ),
      ).rejects.toThrow(new InternalAbortError("Evaluator timed out"));

      await vi.advanceTimersByTimeAsync(10);
      await runExpect;

      // first 3 tasks complete and 4th task was started but not completed before timeout
      expect(taskStarts).toEqual(new Set([0, 1, 2, 3]));
      expect(taskCompletions).toEqual(new Set([0, 1, 2]));

      await vi.advanceTimersByTimeAsync(200);

      // no other tasks are started after evaluator is aborted and the 4th in-flight task completes
      expect(taskStarts).toEqual(new Set([0, 1, 2, 3]));
      expect(taskCompletions).toEqual(new Set([0, 1, 2, 3]));
      expect(vi.getTimerCount()).toBe(0);
    });

    test("runEvaluator rejects on abort signal and kills remaining tasks", async () => {
      const taskStarts: Set<number> = new Set();
      const taskCompletions: Set<number> = new Set();

      const abortController = new AbortController();

      const runExpect = expect(
        runEvaluator(
          null,
          {
            projectName: "proj",
            evalName: "eval",
            data: Array.from({ length: 10 }, (_, i) => ({
              input: i,
              expected: i * 2,
            })),
            task: async (input: number) => {
              taskStarts.add(input);
              if (input > 2) {
                await new Promise((r) => setTimeout(r, 100));
              }
              taskCompletions.add(input);
              return input * 2;
            },
            scores: [],
            signal: abortController.signal,
            maxConcurrency: 1,
          },
          new NoopProgressReporter(),
          [],
          undefined,
        ),
      ).rejects.toThrow(new InternalAbortError("Evaluator aborted"));

      await vi.advanceTimersByTimeAsync(10);
      abortController.abort();
      await runExpect;

      // first 3 tasks complete and 4th task was started but not completed before abort
      expect(taskStarts).toEqual(new Set([0, 1, 2, 3]));
      expect(taskCompletions).toEqual(new Set([0, 1, 2]));

      await vi.advanceTimersByTimeAsync(200);

      // no other tasks are started after evaluator is aborted and the 4th in-flight task completes
      expect(taskStarts).toEqual(new Set([0, 1, 2, 3]));
      expect(taskCompletions).toEqual(new Set([0, 1, 2, 3]));
      expect(vi.getTimerCount()).toBe(0);
    });

    test("runEvaluator works with no timeout or abort signal", async () => {
      const run = runEvaluator(
        null,
        {
          projectName: "proj",
          evalName: "eval",
          data: [{ input: 1, expected: 2 }],
          task: async (input: number) => {
            await new Promise((r) => setTimeout(r, 100));
            return input * 2;
          },
          scores: [],
        },
        new NoopProgressReporter(),
        [],
        undefined,
      );

      await vi.advanceTimersByTimeAsync(100);
      await run;
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("experiment propagation", () => {
    // For these tests, we'll capture the experiment passed to hooks
    // but use null for the actual runEvaluator since we're not testing
    // the full experiment functionality, just hook propagation

    test("experiment is undefined in hooks when no experiment provided", async () => {
      const capturedExperiments: (any | undefined)[] = [];

      const out = await runEvaluator(
        null, // No experiment provided
        {
          projectName: "proj",
          evalName: "eval",
          data: [{ input: 1, expected: 2 }],
          task: async (input: number, hooks) => {
            capturedExperiments.push(hooks.experiment);
            return input * 2;
          },
          scores: [],
        },
        new NoopProgressReporter(),
        [],
        undefined,
      );

      expect(capturedExperiments).toHaveLength(1);
      expect(capturedExperiments[0]).toBeUndefined();
    });

    test("experiment propagation works with multiple data points", async () => {
      const capturedExperiments: (any | undefined)[] = [];

      const out = await runEvaluator(
        null,
        {
          projectName: "proj",
          evalName: "eval",
          data: [
            { input: 1, expected: 2 },
            { input: 2, expected: 4 },
            { input: 3, expected: 6 },
          ],
          task: async (input: number, hooks) => {
            capturedExperiments.push(hooks.experiment);
            return input * 2;
          },
          scores: [],
        },
        new NoopProgressReporter(),
        [],
        undefined,
      );

      expect(capturedExperiments).toHaveLength(3);
      capturedExperiments.forEach((exp) => {
        expect(exp).toBeUndefined();
      });
    });

    test("experiment in hooks works alongside other hook properties", async () => {
      const capturedHooks: any[] = [];

      const out = await runEvaluator(
        null,
        {
          projectName: "proj",
          evalName: "eval",
          data: [{ input: 1, expected: 2, metadata: { test: "value" } }],
          task: async (input: number, hooks) => {
            capturedHooks.push({
              experiment: hooks.experiment,
              metadata: hooks.metadata,
              expected: hooks.expected,
              span: hooks.span,
              parameters: hooks.parameters,
              hasReportProgress: typeof hooks.reportProgress === "function",
              hasMeta: typeof hooks.meta === "function",
              trialIndex: hooks.trialIndex,
            });
            return input * 2;
          },
          scores: [],
        },
        new NoopProgressReporter(),
        [],
        undefined,
      );

      expect(capturedHooks).toHaveLength(1);
      const hook = capturedHooks[0];
      
      // Verify experiment is undefined when no experiment provided
      expect(hook.experiment).toBeUndefined();
      
      // Verify other hook properties still work
      expect(hook.metadata).toBeDefined();
      expect(hook.metadata.test).toBe("value");
      expect(hook.expected).toBe(2);
      expect(hook.span).toBeDefined();
      expect(hook.parameters).toBeDefined();
      expect(hook.hasReportProgress).toBe(true);
      expect(hook.hasMeta).toBe(true);
      expect(hook.trialIndex).toBe(0);
    });

    test("tasks without hooks parameter still work when no experiment", async () => {
      // Task without hooks parameter should still work
      const out = await runEvaluator(
        null,
        {
          projectName: "proj", 
          evalName: "eval",
          data: [{ input: 1, expected: 2 }],
          task: async (input: number) => {
            // This task doesn't use hooks, so it shouldn't get them
            return input * 2;
          },
          scores: [],
        },
        new NoopProgressReporter(),
        [],
        undefined,
      );

      expect(out.results).toHaveLength(1);
      expect(out.results[0].output).toBe(2);
      expect(out.results[0].error).toBeUndefined();
    });

    test("experiment and trialIndex work together in hooks", async () => {
      const capturedHooks: any[] = [];

      const out = await runEvaluator(
        null,
        {
          projectName: "proj",
          evalName: "eval",
          data: [{ input: 1, expected: 2 }],
          task: async (input: number, hooks) => {
            capturedHooks.push({
              experiment: hooks.experiment,
              trialIndex: hooks.trialIndex,
            });
            return input * 2;
          },
          scores: [],
          trialCount: 3,
        },
        new NoopProgressReporter(),
        [],
        undefined,
      );

      expect(capturedHooks).toHaveLength(3);
      capturedHooks.forEach((hook, index) => {
        expect(hook.experiment).toBeUndefined();
        expect(hook.trialIndex).toBe(index);
      });
    });
  });
});

test("trialIndex is passed to task", async () => {
  const trialIndices: number[] = [];

  const { results } = await runEvaluator(
    null,
    {
      projectName: "proj",
      evalName: "eval",
      data: [{ input: 1, expected: 2 }],
      task: async (input: number, { trialIndex }) => {
        trialIndices.push(trialIndex);
        return input * 2;
      },
      scores: [],
      trialCount: 3,
    },
    new NoopProgressReporter(),
    [],
  );

  // Should have 3 results (one for each trial)
  expect(results).toHaveLength(3);

  // Should have captured 3 trial indices
  expect(trialIndices).toHaveLength(3);
  expect(trialIndices.sort()).toEqual([0, 1, 2]);

  // All results should be correct
  results.forEach((result) => {
    expect(result.input).toBe(1);
    expect(result.expected).toBe(2);
    expect(result.output).toBe(2);
    expect(result.error).toBeUndefined();
  });
});

test("trialIndex with multiple inputs", async () => {
  const trialData: Array<{ input: number; trialIndex: number }> = [];

  const { results } = await runEvaluator(
    null,
    {
      projectName: "proj",
      evalName: "eval",
      data: [
        { input: 1, expected: 2 },
        { input: 2, expected: 4 },
      ],
      task: async (input: number, { trialIndex }) => {
        trialData.push({ input, trialIndex });
        return input * 2;
      },
      scores: [],
      trialCount: 2,
    },
    new NoopProgressReporter(),
    [],
  );

  // Should have 4 results total (2 inputs × 2 trials)
  expect(results).toHaveLength(4);
  expect(trialData).toHaveLength(4);

  // Group by input to verify trial indices
  const input1Trials = trialData
    .filter((d) => d.input === 1)
    .map((d) => d.trialIndex)
    .sort();
  const input2Trials = trialData
    .filter((d) => d.input === 2)
    .map((d) => d.trialIndex)
    .sort();

  // Each input should have been run with trial indices 0 and 1
  expect(input1Trials).toEqual([0, 1]);
  expect(input2Trials).toEqual([0, 1]);
});
