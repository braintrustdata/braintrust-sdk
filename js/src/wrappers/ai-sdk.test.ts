import { describe, it, expect } from "vitest";
import { postProcessPrompt, postProcessOutput } from "./ai-sdk";
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

    const result = postProcessOutput(undefined, toolCalls, "tool_calls");

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
