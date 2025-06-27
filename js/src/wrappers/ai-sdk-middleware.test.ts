import { expect, test, describe } from "vitest";
import { generateText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { Middleware } from "./ai-sdk-middleware";

const testModelName = "gpt-4.1";

test("ai sdk middleware is installed", () => {
  expect(wrapLanguageModel).toBeDefined();
  expect(openai).toBeDefined();
});

describe("ai sdk middleware tests", () => {
  test("generateText wrapLanguageModel", async () => {
    const tm = openai(testModelName);

    const wrapped = wrapLanguageModel({
      model: tm,
      middleware: Middleware({ debug: true, name: "TestMiddleware" }),
    });

    for (const [_, model] of [wrapped, tm].entries()) {
      const isWrapped = model === wrapped;

      console.log(isWrapped ? "wrapped" : "not wrapped");

      const { text } = await generateText({
        model: model,
        prompt: "What is 2+2?",
        system: "Just return the number",
      });
      console.log(text);
    }
  });
});
