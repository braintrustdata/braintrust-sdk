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
  getSingleValueParameters,
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

test("getSingleValueParameters with no parameters returns a single object", () => {
  const params = {};

  const result = getSingleValueParameters(params);
  expect(result).toEqual([params]);
});

test("getSingleValueParameters with no array values returns original object", () => {
  const params = {
    a: 1,
    b: "test",
    c: true,
  };

  const result = getSingleValueParameters(params);
  expect(result).toEqual([params]);
});

test("getSingleValueParameters with single array value generates combinations", () => {
  const params = {
    a: [1, 2, 3],
    b: "test",
  };

  const result = getSingleValueParameters(params);
  expect(result).toEqual([
    { a: 1, b: "test" },
    { a: 2, b: "test" },
    { a: 3, b: "test" },
  ]);
});

test("getSingleValueParameters with multiple array values generates all combinations", () => {
  const params = {
    a: [1, 2],
    b: ["x", "y"],
    c: true,
  };

  const result = getSingleValueParameters(params);
  expect(result).toEqual([
    { a: 1, b: "x", c: true },
    { a: 1, b: "y", c: true },
    { a: 2, b: "x", c: true },
    { a: 2, b: "y", c: true },
  ]);
});

test("getSingleValueParameters with empty array values", () => {
  const params = {
    a: [],
    b: "test",
  };

  const result = getSingleValueParameters(params);
  expect(result).toEqual([]);
});

test("getSingleValueParameters with mixed types in arrays", () => {
  const params = {
    a: [1, "two", false],
    b: 100,
  };

  const result = getSingleValueParameters(params);
  expect(result).toEqual([
    { a: 1, b: 100 },
    { a: "two", b: 100 },
    { a: false, b: 100 },
  ]);
});

test("getSingleValueParameters with nested objects", () => {
  const params = {
    a: [1, 2],
    b: { x: 1, y: 2 },
  };

  const result = getSingleValueParameters(params);
  expect(result).toEqual([
    { a: 1, b: { x: 1, y: 2 } },
    { a: 2, b: { x: 1, y: 2 } },
  ]);
});

test("getSingleValueParameters preserves object references for non-array values", () => {
  const obj = { x: 1 };
  const params = {
    a: [1, 2],
    b: obj,
  };

  const result = getSingleValueParameters(params);
  expect(result[0].b).toBe(obj);
  expect(result[1].b).toBe(obj);
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
});
