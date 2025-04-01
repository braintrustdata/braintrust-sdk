import { test, expect } from "vitest";
import { wrapAnthropic } from "./exports-node";

test("anthropic is installed", () => {
  expect(wrapAnthropic).toBeDefined();
  expect(wrapAnthropic).toBeInstanceOf(Function);
});
