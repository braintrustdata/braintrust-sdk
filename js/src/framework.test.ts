import { expect, test } from "vitest";
import { runEvaluator } from "./framework";
import { BarProgressReporter } from "./progress";

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
