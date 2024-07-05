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
