import { expect, test } from "vitest";

test("CommonJS environment exposes require", () => {
  const nodeRequire = globalThis.require;
  expect(typeof nodeRequire).toBe("function");
});

