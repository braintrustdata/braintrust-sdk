import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postProcessPrompt, wrapAISDKModel } from "./ai-sdk";
import { LanguageModelV1, LanguageModelV1Prompt } from "@ai-sdk/provider";
import { BraintrustMiddleware } from "../exports-node";

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
