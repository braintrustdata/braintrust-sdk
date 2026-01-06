import { expect, test, describe } from "vitest";
import {
  mapAt,
  forEachMissingKey,
  mergeDicts,
  mergeDictsWithPaths,
  applyArrayDeletes,
} from "./object_util";

function makeAccumulateMissingKeysF() {
  const missingKeys: Record<string, string[]> = {};
  function fn({ k, path }: { k: string; path: string[] }) {
    missingKeys[k] = path;
  }
  return { missingKeys, fn };
}

test("forEachMissingKey basic", () => {
  let lhs = { a: 4, b: "hello", c: { d: "what" }, x: [1, 2, 3] };
  let rhs = { b: lhs.b, q: "hi", c: { e: "yes" }, x: [6, 7, 8, 9] };

  let keysAndFn = makeAccumulateMissingKeysF();
  forEachMissingKey({ lhs, rhs, fn: keysAndFn.fn });
  expect(keysAndFn.missingKeys).toEqual({ q: [], e: ["c"], 3: ["x"] });
});

test("forEachMissingKey structural mismatch", () => {
  let lhs = { a: 4, c: { d: "what" }, x: [1, 2, 3] };
  let rhs: Record<string, any> = { q: "hi", c: "dog", x: { dog: "cat" } };

  let keysAndFn = makeAccumulateMissingKeysF();
  forEachMissingKey({ lhs, rhs, fn: keysAndFn.fn });
  expect(keysAndFn.missingKeys).toEqual({ q: [], dog: ["x"] });
});

test("mergeDicts basic", () => {
  let a = {
    x: 10,
    y: "hello",
    z: {
      a: "yes",
      b: "no",
      c: [1, 2, 3],
    },
    n: { a: 12 },
  };
  let b = {
    y: "goodbye",
    q: "new",
    z: {
      b: "maybe",
      c: 99,
      d: "something",
    },
    n: null,
  };
  mergeDicts(a, b);
  expect(a).toEqual({
    x: 10,
    y: "goodbye",
    z: {
      a: "yes",
      b: "maybe",
      c: 99,
      d: "something",
    },
    n: null,
    q: "new",
  });
});

test("mergeDictsWithPaths", () => {
  function ab() {
    return [
      {
        x: 10,
        y: "hello",
        z: {
          a: "yes",
          b: "no",
          c: [1, 2, 3],
        },
        n: { a: 12 },
      },
      {
        y: "goodbye",
        q: "new",
        z: {
          b: "maybe",
          c: 99,
          d: "something",
        },
        n: null,
      },
    ];
  }

  let fullMerge: Record<string, unknown>,
    a: Record<string, unknown>,
    b: Record<string, unknown>;
  [fullMerge, b] = ab();
  mergeDicts(fullMerge, b);

  [a, b] = ab();
  mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [] });
  expect(a).toEqual(fullMerge);

  [a, b] = ab();
  mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [["z"]] });
  expect(a).toEqual({
    x: 10,
    y: "goodbye",
    z: { b: "maybe", c: 99, d: "something" },
    n: null,
    q: "new",
  });

  [a, b] = ab();
  a["a"] = { y: { a: 10, b: 20 } };
  b["a"] = { y: { a: 20, c: 30 } };
  mergeDictsWithPaths({
    mergeInto: a,
    mergeFrom: b,
    mergePaths: [["z"], ["a", "y"]],
  });
  expect(a).toEqual({
    x: 10,
    y: "goodbye",
    z: { b: "maybe", c: 99, d: "something" },
    n: null,
    q: "new",
    a: { y: { a: 20, c: 30 } },
  });

  [a, b] = ab();
  mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [["z", "b"]] });
  expect(a).toEqual(fullMerge);
});

test("mergeDictsWithPaths ignore undefined", () => {
  function ab() {
    return [
      {
        x: 10,
        y: "hello",
        z: {
          a: "yes",
          b: "no",
        },
        n: { a: 12 },
      },
      {
        y: "goodbye",
        q: "new",
        z: {
          a: undefined,
          b: "maybe",
        },
        n: undefined,
      },
    ];
  }

  let a: Record<string, unknown>, b: Record<string, unknown>;
  [a, b] = ab();
  mergeDicts(a, b);
  expect(a).toEqual({
    x: 10,
    y: "goodbye",
    q: "new",
    z: {
      a: "yes",
      b: "maybe",
    },
    n: { a: 12 },
  });
});

test("mapAt basic", () => {
  const m = new Map<number, string>([
    [4, "hello"],
    [5, "goodbye"],
  ]);
  expect(mapAt(m, 4)).toBe("hello");
  expect(mapAt(m, 5)).toBe("goodbye");
  expect(() => mapAt(m, 6)).toThrowError("Map does not contain key 6");
});

describe("tags set-union merge", () => {
  test("tags arrays are merged as sets by default", () => {
    const a = { tags: ["a", "b"] };
    const b = { tags: ["b", "c"] };
    mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [] });
    expect(a.tags).toEqual(["a", "b", "c"]);
  });

  test("tags merge deduplicates values", () => {
    const a = { tags: ["a", "b", "c"] };
    const b = { tags: ["a", "b", "c", "d"] };
    mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [] });
    expect(a.tags).toEqual(["a", "b", "c", "d"]);
  });

  test("tags merge works when mergeInto has no tags", () => {
    const a: Record<string, unknown> = { other: "data" };
    const b = { tags: ["a", "b"] };
    mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [] });
    expect(a.tags).toEqual(["a", "b"]);
  });

  test("tags merge works when mergeFrom has no tags", () => {
    const a = { tags: ["a", "b"] };
    const b: Record<string, unknown> = { other: "data" };
    mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [] });
    expect(a.tags).toEqual(["a", "b"]);
  });

  test("tags are replaced when included in mergePaths", () => {
    const a = { tags: ["a", "b"] };
    const b = { tags: ["c", "d"] };
    mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [["tags"]] });
    expect(a.tags).toEqual(["c", "d"]);
  });

  test("empty tags array clears tags", () => {
    const a = { tags: ["a", "b"] };
    const b = { tags: [] as string[] };
    mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [["tags"]] });
    expect(a.tags).toEqual([]);
  });

  test("null tags replaces tags", () => {
    const a: Record<string, unknown> = { tags: ["a", "b"] };
    const b: Record<string, unknown> = { tags: null };
    mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [] });
    expect(a.tags).toEqual(null);
  });

  test("set-union only applies to top-level tags field", () => {
    const a = { metadata: { tags: ["a", "b"] } };
    const b = { metadata: { tags: ["c", "d"] } };
    mergeDictsWithPaths({ mergeInto: a, mergeFrom: b, mergePaths: [] });
    expect(a.metadata.tags).toEqual(["c", "d"]);
  });
});

describe("applyArrayDeletes", () => {
  test("removes specified values from array", () => {
    const target = { tags: ["a", "b", "c", "d"] };
    applyArrayDeletes(target, { tags: ["b", "d"] });
    expect(target.tags).toEqual(["a", "c"]);
  });

  test("handles non-existent values gracefully", () => {
    const target = { tags: ["a", "b", "c"] };
    applyArrayDeletes(target, { tags: ["x", "y", "z"] });
    expect(target.tags).toEqual(["a", "b", "c"]);
  });

  test("handles empty delete array", () => {
    const target = { tags: ["a", "b", "c"] };
    applyArrayDeletes(target, { tags: [] });
    expect(target.tags).toEqual(["a", "b", "c"]);
  });

  test("handles non-existent field gracefully", () => {
    const target: Record<string, unknown> = { other: "data" };
    applyArrayDeletes(target, { tags: ["a"] });
    expect(target).toEqual({ other: "data" });
  });

  test("handles nested paths with dot notation", () => {
    const target = { metadata: { categories: ["a", "b", "c"] } };
    applyArrayDeletes(target, { "metadata.categories": ["b"] });
    expect(target.metadata.categories).toEqual(["a", "c"]);
  });

  test("handles multiple fields", () => {
    const target = {
      tags: ["a", "b", "c"],
      labels: ["x", "y", "z"],
    };
    applyArrayDeletes(target, {
      tags: ["b"],
      labels: ["y"],
    });
    expect(target.tags).toEqual(["a", "c"]);
    expect(target.labels).toEqual(["x", "z"]);
  });

  test("handles object values using JSON comparison", () => {
    const target = {
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    };
    applyArrayDeletes(target, { items: [{ id: 2 }] });
    expect(target.items).toEqual([{ id: 1 }, { id: 3 }]);
  });

  test("ignores non-array delete values", () => {
    const target = { tags: ["a", "b", "c"] };
    applyArrayDeletes(target, { tags: "not-an-array" as unknown as unknown[] });
    expect(target.tags).toEqual(["a", "b", "c"]);
  });

  test("ignores when target field is not an array", () => {
    const target: Record<string, unknown> = { tags: "not-an-array" };
    applyArrayDeletes(target, { tags: ["a"] });
    expect(target.tags).toEqual("not-an-array");
  });
});
