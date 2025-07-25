import { describe, it, expect } from "vitest";
import { postProcessOutput, postProcessPrompt } from "./ai-sdk-v1";
import { BraintrustMiddleware } from "../exports-node";
import {
  LanguageModelV1Prompt,
  LanguageModelV1FunctionToolCall,
} from "@ai-sdk/provider";

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

  it("should import BraintrustMiddleware from braintrust package", () => {
    expect(typeof BraintrustMiddleware).toBe("function");

    // Should be able to call it and get middleware object back
    const middleware = BraintrustMiddleware({});
    expect(middleware).toHaveProperty("wrapGenerate");
    expect(middleware).toHaveProperty("wrapStream");
    expect(typeof middleware.wrapGenerate).toBe("function");
    expect(typeof middleware.wrapStream).toBe("function");
  });
});

describe("postProcessOutput", () => {
  it("should format tool calls correctly in OpenAI format", () => {
    const toolCalls: LanguageModelV1FunctionToolCall[] = [
      {
        toolCallType: "function",

        toolCallId: "call_abc123",

        toolName: "get_weather",

        args: '{"location": "San Francisco", "unit": "celsius"}',
      },
    ];

    const result = postProcessOutput(undefined, toolCalls, "tool-calls");

    // Tool calls should be properly formatted in OpenAI format

    expect(result).toEqual({
      index: 0,

      message: {
        role: "assistant",

        content: "",

        tool_calls: [
          {
            id: "call_abc123",

            type: "function",

            function: {
              name: "get_weather",

              arguments: '{"location": "San Francisco", "unit": "celsius"}',
            },
          },
        ],
      },

      finish_reason: "tool_calls",
    });
  });
});
