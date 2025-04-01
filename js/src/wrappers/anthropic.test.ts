import { test, expect } from "vitest";
import { Anthropic } from "@anthropic-ai/sdk";

test("anthropic is installed", () => {
  expect(Anthropic).toBeDefined();
});
