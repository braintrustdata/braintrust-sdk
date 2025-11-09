import { expect, test } from "vitest";

test("ESM environment disables require", () => {
  expect(globalThis.require).toBeUndefined();
});

test("ESM environment exposes import.meta", () => {
  expect(typeof import.meta.url).toBe("string");
});

