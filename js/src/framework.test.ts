import { beforeAll, expect, describe, test } from "vitest";
import {
  defaultErrorScoreHandler,
  EvalScorer,
  runEvaluator,
} from "./framework";
import { configureNode } from "./node";
import { BarProgressReporter, type ProgressReporter } from "./progress";

beforeAll(() => {
  configureNode();
});

class NoopProgressReporter implements ProgressReporter {
  public start() {}
  public stop() {}
  public increment() {}
}

test("runEvaluator rejects on timeout", async () => {
  await expect(
    runEvaluator(
      null,
      {
        projectName: "proj",
        evalName: "eval",
        data: [{ input: 1, expected: 2 }],
        task: async (input: number) => {
          await new Promise((r) => setTimeout(r, 100000));
          return input * 2;
        },
        scores: [],
        timeout: 100,
      },
      new NoopProgressReporter(),
      [],
      undefined,
    ),
  ).rejects.toEqual(new Error("Evaluator timed out"));
});

test("runEvaluator rejects on abort signal", async () => {
  const abortController = new AbortController();

  setTimeout(() => abortController.abort(), 1000);
  await expect(
    runEvaluator(
      null,
      {
        projectName: "proj",
        evalName: "eval",
        data: [{ input: 1, expected: 2 }],
        task: async (input: number) => {
          await new Promise((r) => setTimeout(r, 100000));
          return input * 2;
        },
        scores: [],
        signal: abortController.signal,
      },
      new NoopProgressReporter(),
      [],
      undefined,
    ),
  ).rejects.toEqual(new Error("Evaluator aborted"));
});

test("runEvaluator works with no timeout or abort signal", async () => {
  await runEvaluator(
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
});

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
});
