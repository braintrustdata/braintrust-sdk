import { beforeAll, expect, describe, test } from "vitest";
import { EvalScorer, runEvaluator } from "./framework";
import { configureNode } from "./node";
import { BarProgressReporter } from "./progress";

beforeAll(() => {
  configureNode();
});

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
      new BarProgressReporter(),
      [],
      undefined,
    ),
  ).rejects.toEqual("evaluator timed out");
});

test("runEvaluator works with no timeout", async () => {
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
    new BarProgressReporter(),
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
    new BarProgressReporter(),
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
    new BarProgressReporter(),
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
    new BarProgressReporter(),
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
        new BarProgressReporter(),
        [],
        undefined,
      );

      expect(
        out.results.every((r) => Object.keys(r.scores).length === 0),
      ).toBeTruthy();
    });

    describe("unhandledScoresFallback", () => {
      describe("function", () => {
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
              unhandledScoresFallback: () => undefined,
            },
            new BarProgressReporter(),
            [],
            undefined,
          );

          expect(
            out.results.every((r) => Object.keys(r.scores).length === 0),
          ).toBeTruthy();
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
              unhandledScoresFallback: () => ({ error_score: 1 }),
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
          ).toBeTruthy();
        });
      });

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
            unhandledScoresFallback: true,
          },
          new BarProgressReporter(),
          [],
          undefined,
        );

        expect(
          out.results.every(
            (r) =>
              Object.keys(r.scores).length === 3 &&
              Object.values(r.scores).every((v) => v === 0),
          ),
        ).toBeTruthy();
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
            unhandledScoresFallback: true,
          },
          new BarProgressReporter(),
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
        ).toBeTruthy();
      });
    });
  });
});
