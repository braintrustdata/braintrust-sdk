import { beforeAll, expect, test } from "vitest";
import { getSingleValueParameters, runEvaluator } from "./framework";
import { BarProgressReporter } from "./progress";
import { configureNode } from "./node";

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
