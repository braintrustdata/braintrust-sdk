import { describe, it, expect } from "vitest";
import { postProcessPrompt } from "./ai-sdk";
import { LanguageModelV1Prompt } from "@ai-sdk/provider";

describe("postProcessPrompt", () => {
  it("correctly processes a simple chat prompt", () => {
    const prompt: LanguageModelV1Prompt = [
      {
        role: "system",
        content: "Hi!",
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello, how can I help?",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "What is the capital of France?",
          },
        ],
      },
    ];

    const result = postProcessPrompt(prompt);

    expect(result).toEqual([
      {
        role: "system",
        content: "Hi!",
      },
      {
        role: "assistant",
        content: "Hello, how can I help?",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "What is the capital of France?",
          },
        ],
      },
    ]);
  });
});
