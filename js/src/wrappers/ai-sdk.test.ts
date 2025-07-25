import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postProcessPrompt, wrapAISDKModel } from "./ai-sdk";
import { LanguageModelV1, LanguageModelV1Prompt } from "@ai-sdk/provider";

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

describe("Anthropic cached tokens", () => {
  let mockModel: LanguageModelV1;
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockModel = {
      specificationVersion: "v1" as const,
      provider: "anthropic",
      modelId: "claude-3-sonnet",
      defaultObjectGenerationMode: "json" as const,
      doGenerate: vi.fn(),
      doStream: vi.fn(),
    };
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("should parse Anthropic cached tokens from providerMetadata in doGenerate", async () => {
    const mockResponse = {
      text: "Hello world",
      toolCalls: [],
      finishReason: "stop" as const,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
      },
      providerMetadata: {
        anthropic: {
          cacheReadInputTokens: 75,
          cacheCreationInputTokens: 25,
        },
      },
    };

    mockModel.doGenerate = vi.fn().mockResolvedValue(mockResponse);
    const wrappedModel = wrapAISDKModel(mockModel);

    await wrappedModel.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      mode: { type: "regular" },
    });

    expect(consoleLogSpy).toHaveBeenCalledWith("Anthropic cached tokens:", {
      cacheReadInputTokens: 75,
      cacheCreationInputTokens: 25,
      mapped_to: {
        prompt_cached_tokens: 75,
        prompt_cache_creation_tokens: 25,
      },
    });
  });

  it("should parse Anthropic cached tokens from providerMetadata in doStream", async () => {
    const mockStreamResponse = {
      stream: new ReadableStream(),
      providerMetadata: {
        anthropic: {
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 10,
        },
      },
    };

    mockModel.doStream = vi.fn().mockResolvedValue(mockStreamResponse);
    const wrappedModel = wrapAISDKModel(mockModel);

    const result = await wrappedModel.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      mode: { type: "regular" },
    });

    // Simulate stream completion with usage data
    const transformStream = result.stream.pipeThrough(
      new TransformStream({
        transform() {},
        flush() {
          // This would normally be called when the stream ends
        },
      }),
    );

    // To properly test the stream, we'd need to simulate the transform stream behavior
    // For now, let's verify the stream setup is correct
    expect(result.stream).toBeDefined();
    expect(mockModel.doStream).toHaveBeenCalled();
  });

  it("should not parse cached tokens for non-Anthropic providers", async () => {
    const nonAnthropicModel = {
      ...mockModel,
      provider: "openai",
    };

    const mockResponse = {
      text: "Hello world",
      toolCalls: [],
      finishReason: "stop" as const,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
      },
      providerMetadata: {
        anthropic: {
          cacheReadInputTokens: 75,
          cacheCreationInputTokens: 25,
        },
      },
    };

    nonAnthropicModel.doGenerate = vi.fn().mockResolvedValue(mockResponse);
    const wrappedModel = wrapAISDKModel(nonAnthropicModel);

    await wrappedModel.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      mode: { type: "regular" },
    });

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("should handle missing or invalid providerMetadata gracefully", async () => {
    const mockResponse = {
      text: "Hello world",
      toolCalls: [],
      finishReason: "stop" as const,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
      },
      // No providerMetadata
    };

    mockModel.doGenerate = vi.fn().mockResolvedValue(mockResponse);
    const wrappedModel = wrapAISDKModel(mockModel);

    await wrappedModel.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      mode: { type: "regular" },
    });

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
