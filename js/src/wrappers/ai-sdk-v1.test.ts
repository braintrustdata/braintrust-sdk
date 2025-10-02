import { describe, it, expect, vi } from "vitest";
import {
  wrapAISDKModel,
  postProcessOutput,
  postProcessPrompt,
} from "./ai-sdk-v1";
import { BraintrustMiddleware } from "../exports-node";
import {
  LanguageModelV1Prompt,
  LanguageModelV1FunctionToolCall,
  LanguageModelV1,
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
    expect(result).toEqual([
      {
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
        finish_reason: "tool-calls",
      },
    ]);
  });
});

describe("BraintrustLanguageModelWrapper", () => {
  const createMockModel = (
    overrides: Partial<LanguageModelV1> = {},
  ): LanguageModelV1 => ({
    specificationVersion: "v1",
    provider: "test-provider",
    modelId: "test-model",
    defaultObjectGenerationMode: "json",
    supportsImageUrls: true,
    supportsStructuredOutputs: true,
    doGenerate: vi.fn().mockResolvedValue({
      text: "test",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1 },
      rawCall: { rawPrompt: "", rawSettings: {} },
    }),
    doStream: vi.fn().mockResolvedValue({
      stream: new ReadableStream(),
      rawCall: { rawPrompt: "", rawSettings: {} },
    }),
    ...overrides,
  });

  it("should forward supportsUrl calls to the underlying model", () => {
    const mockSupportsUrl = vi.fn((url: URL) => url.protocol === "https:");
    const underlyingModel = createMockModel({ supportsUrl: mockSupportsUrl });

    const wrapper = wrapAISDKModel(underlyingModel);
    const testUrl = new URL("https://example.com");

    const result = wrapper.supportsUrl?.(testUrl);

    expect(mockSupportsUrl).toHaveBeenCalledWith(testUrl);
    expect(result).toBe(true);
  });

  it("should not define supportsUrl when underlying model has no supportsUrl", () => {
    const underlyingModel = createMockModel();

    const wrapper = wrapAISDKModel(underlyingModel);

    expect(wrapper.supportsUrl).toBeUndefined();
  });
});

describe("ai-sdk exports", () => {
  it("should always export BraintrustMiddleware as a function", () => {
    expect(typeof BraintrustMiddleware).toBe("function");
  });

  it("BraintrustMiddleware should return an object with wrapGenerate and wrapStream", () => {
    const result = BraintrustMiddleware({});
    expect(result).toHaveProperty("wrapGenerate");
    expect(result).toHaveProperty("wrapStream");
    expect(typeof result.wrapGenerate).toBe("function");
    expect(typeof result.wrapStream).toBe("function");
  });

  it("should handle conditional imports gracefully", () => {
    // Test that imports don't throw errors regardless of AI SDK version
    expect(() => {
      const middleware = BraintrustMiddleware({ debug: true });

      // Should be able to call the functions without errors
      const { wrapGenerate, wrapStream } = middleware;

      expect(wrapGenerate).toBeDefined();
      expect(wrapStream).toBeDefined();
    }).not.toThrow();
  });

  it("should export middleware functions that can be instantiated", () => {
    const middleware = BraintrustMiddleware({});
    const { wrapGenerate, wrapStream } = middleware;

    // Should be functions that can be called (we don't test actual execution due to logger dependencies)
    expect(typeof wrapGenerate).toBe("function");
    expect(typeof wrapStream).toBe("function");
  });
});
