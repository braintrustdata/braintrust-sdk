import { expect, test } from "vitest";
import * as util from "./util";

test("mapAt basic", () => {
  const m = new Map<number, string>([
    [4, "hello"],
    [5, "goodbye"],
  ]);
  expect(util.mapAt(m, 4)).toBe("hello");
  expect(util.mapAt(m, 5)).toBe("goodbye");
  expect(() => util.mapAt(m, 6)).toThrowError("Map does not contain key 6");
});

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
  util.forEachMissingKey({ lhs, rhs, fn: keysAndFn.fn });
  expect(keysAndFn.missingKeys).toEqual({ q: [], e: ["c"], 3: ["x"] });
});

test("forEachMissingKey structural mismatch", () => {
  let lhs = { a: 4, c: { d: "what" }, x: [1, 2, 3] };
  let rhs: Record<string, any> = { q: "hi", c: "dog", x: { dog: "cat" } };

  let keysAndFn = makeAccumulateMissingKeysF();
  expect(() =>
    util.forEachMissingKey({ lhs, rhs, fn: keysAndFn.fn }),
  ).toThrowError(`Type mismatch between lhs and rhs object at path ["c"]`);

  // Should work if we take away element `c`.
  delete rhs["c"];
  keysAndFn = makeAccumulateMissingKeysF();
  util.forEachMissingKey({ lhs, rhs, fn: keysAndFn.fn });
  expect(keysAndFn.missingKeys).toEqual({ q: [], dog: ["x"] });
});
