import { test, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "./anthropic";
import { TextBlock } from "@anthropic-ai/sdk/resources/messages";

// use the cheapest model for tests
const TEST_MODEL = "claude-3-haiku-20240307";

test("anthropic is installed", () => {
  expect(Anthropic).toBeDefined();
});

test("test anthropic client", async () => {
  const client = wrapAnthropic(new Anthropic());

  const response = await client.messages.create({
    model: TEST_MODEL,
    messages: [{ role: "user", content: "What's 4*4?" }],
    max_tokens: 100,
    system: "Return the result only.",
  });

  expect(response).toBeDefined();
  expect(response.content[0].type).toBe("text");
  const content = response.content[0] as TextBlock;
  expect(content.text).toContain("16");
});
