import { test, assert, expect } from "vitest";
import { configureNode } from "../node";
import OpenAI from "openai";

// use the cheapest model for tests
const TEST_MODEL = "gpt-4o-mini";

try {
  configureNode();
} catch (e) {
  // FIXME[matt] have a better of way of initializing brainstrust state once per process.
}

test("openai is installed", () => {
  assert.ok(OpenAI);
});
