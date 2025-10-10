import { describe, it, expect } from "vitest";

import {
  detectProviderFromResult,
  extractModelFromResult,
  extractModelFromWrapGenerateCallback,
  camelToSnake,
  extractModelParameters,
  getNumberProperty,
  normalizeUsageMetrics,
  normalizeFinishReason,
  extractToolCallsFromSteps,
  buildAssistantOutputWithToolCalls,
  extractToolCallsFromBlocks,
  extractInput,
} from "./ai-sdk-shared";

describe("ai-sdk-shared utilities", () => {
  describe("detectProviderFromResult", () => {
    it("should return first provider key from providerMetadata", () => {
      const result = {
        providerMetadata: {
          openai: { id: "chatcmpl-123" },
          anthropic: { id: "msg-456" },
        },
      };
      expect(detectProviderFromResult(result)).toBe("openai");
    });

    it("should return undefined for missing providerMetadata", () => {
      expect(detectProviderFromResult({})).toBeUndefined();
      expect(
        detectProviderFromResult({ providerMetadata: {} }),
      ).toBeUndefined();
    });
  });

  describe("extractModelFromResult", () => {
    it("should extract model from response.modelId", () => {
      const result = {
        response: { modelId: "gpt-4" },
        request: { body: { model: "gpt-3.5-turbo" } },
      };
      expect(extractModelFromResult(result)).toBe("gpt-4");
    });

    it("should fallback to request.body.model", () => {
      const result = {
        request: { body: { model: "gpt-3.5-turbo" } },
      };
      expect(extractModelFromResult(result)).toBe("gpt-3.5-turbo");
    });

    it("should return undefined if no model found", () => {
      expect(extractModelFromResult({})).toBeUndefined();
    });
  });

  describe("extractModelFromWrapGenerateCallback", () => {
    it("should extract model from wrapGenerate callback", () => {
      expect(
        extractModelFromWrapGenerateCallback({
          modelId: "us.anthropic.claude-sonnet-4-20250514-v1:0",
          config: {
            headers: {},
          },
          specificationVersion: "v2",
          provider: "amazon-bedrock",
          supportedUrls: {},
        }),
      ).toBe("us.anthropic.claude-sonnet-4-20250514-v1:0");
    });
  });

  describe("camelToSnake", () => {
    it("should convert camelCase to snake_case", () => {
      expect(camelToSnake("maxTokens")).toBe("max_tokens");
      expect(camelToSnake("temperature")).toBe("temperature");
      expect(camelToSnake("topP")).toBe("top_p");
      expect(camelToSnake("frequencyPenalty")).toBe("frequency_penalty");
    });
  });

  describe("extractModelParameters", () => {
    it("should extract parameters excluding specified keys", () => {
      const params = {
        prompt: "Hello",
        temperature: 0.7,
        maxTokens: 100,
        topP: 0.9,
        model: "gpt-4",
        tools: [],
      };
      const excludeKeys = new Set(["prompt", "model", "tools"]);

      const result = extractModelParameters(params, excludeKeys);

      expect(result).toEqual({
        temperature: 0.7,
        max_tokens: 100,
        top_p: 0.9,
      });
    });

    it("should skip undefined values", () => {
      const params = {
        temperature: 0.7,
        maxTokens: undefined,
        topP: 0.9,
      };
      const excludeKeys = new Set([]);

      const result = extractModelParameters(params, excludeKeys);

      expect(result).toEqual({
        temperature: 0.7,
        top_p: 0.9,
      });
    });
  });

  describe("getNumberProperty", () => {
    it("should extract number properties", () => {
      const obj = { tokens: 100, text: "hello", nested: { count: 5 } };
      expect(getNumberProperty(obj, "tokens")).toBe(100);
      expect(getNumberProperty(obj, "text")).toBeUndefined();
      expect(getNumberProperty(obj, "missing")).toBeUndefined();
    });

    it("should handle non-objects", () => {
      expect(getNumberProperty(null, "tokens")).toBeUndefined();
      expect(getNumberProperty("string", "tokens")).toBeUndefined();
      expect(getNumberProperty(123, "tokens")).toBeUndefined();
    });
  });

  describe("normalizeUsageMetrics", () => {
    it("should normalize standard AI SDK usage fields", () => {
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        reasoningTokens: 2,
        cachedInputTokens: 3,
      };

      const result = normalizeUsageMetrics(usage);

      expect(result).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        tokens: 15,
        completion_reasoning_tokens: 2,
        prompt_cached_tokens: 3,
      });
    });

    it("should handle Anthropic provider with cache tokens", () => {
      const usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };
      const providerMetadata = {
        anthropic: {
          usage: {
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 20,
          },
        },
      };

      const result = normalizeUsageMetrics(
        usage,
        "anthropic",
        providerMetadata,
      );

      expect(result).toEqual(
        expect.objectContaining({
          completion_tokens: 50,
          // Anthropic token finalization may adjust these values
          prompt_tokens: expect.any(Number),
          tokens: expect.any(Number),
        }),
      );

      // Should include cache-specific metrics
      expect(typeof result.prompt_cached_tokens).toBe("number");
    });

    it("should handle missing or invalid usage", () => {
      expect(normalizeUsageMetrics(null)).toEqual({});
      expect(normalizeUsageMetrics(undefined)).toEqual({});
      expect(normalizeUsageMetrics({})).toEqual({});
    });

    it("should skip non-number values", () => {
      const usage = {
        inputTokens: "invalid",
        outputTokens: 5,
        totalTokens: null,
      };

      const result = normalizeUsageMetrics(usage);

      expect(result).toEqual({
        completion_tokens: 5,
      });
    });
  });

  describe("normalizeFinishReason + tool parsing", () => {
    it("normalizes hyphen to underscore and leaves others unchanged", () => {
      expect(normalizeFinishReason("tool-calls")).toBe("tool_calls");
      expect(normalizeFinishReason("stop")).toBe("stop");
      expect(normalizeFinishReason(123 as any)).toBeUndefined();
    });

    it("extracts tool calls across multiple steps with incremental index", () => {
      const steps = [
        {
          content: [
            { type: "tool-call", toolCallId: "a", toolName: "A", input: {} },
          ],
        },
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "b",
              toolName: "B",
              input: { x: 1 },
            },
          ],
        },
      ];
      const calls = extractToolCallsFromSteps(steps as any);
      expect(calls).toEqual([
        {
          id: "a",
          type: "function",
          index: 0,
          function: { name: "A", arguments: "{}" },
        },
        {
          id: "b",
          type: "function",
          index: 1,
          function: { name: "B", arguments: JSON.stringify({ x: 1 }) },
        },
      ]);
    });

    it("extracts tool calls from blocks convenience", () => {
      const blocks = [
        {
          type: "tool-call",
          toolCallId: "x",
          toolName: "X",
          input: { a: true },
        },
      ];
      const calls = extractToolCallsFromBlocks(blocks as any);
      expect(calls).toEqual([
        {
          id: "x",
          type: "function",
          index: 0,
          function: { name: "X", arguments: JSON.stringify({ a: true }) },
        },
      ]);
    });

    it("buildAssistantOutputWithToolCalls respects provided finishReason and absence of tool_calls", () => {
      const out = buildAssistantOutputWithToolCalls(
        { finishReason: "stop" } as any,
        [],
      );
      expect(out).toEqual([
        {
          index: 0,
          logprobs: null,
          finish_reason: "stop",
          message: { role: "assistant", tool_calls: undefined },
        },
      ]);

      const out2 = buildAssistantOutputWithToolCalls({} as any, []);
      expect(out2).toEqual([
        {
          index: 0,
          logprobs: null,
          finish_reason: undefined,
          message: { role: "assistant", tool_calls: undefined },
        },
      ]);
    });
  });

  describe("extractInput", () => {
    it("prefers prompt, then messages, then system", () => {
      expect(extractInput({ prompt: "p", messages: [1], system: "s" })).toBe(
        "p",
      );
      expect(
        extractInput({ prompt: undefined, messages: [1], system: "s" }),
      ).toEqual([1]);
      expect(
        extractInput({ prompt: undefined, messages: undefined, system: "s" }),
      ).toBe("s");
    });

    it("returns undefined if none present", () => {
      expect(extractInput({})).toBeUndefined();
      expect(extractInput(undefined as any)).toBeUndefined();
      expect(extractInput(null as any)).toBeUndefined();
    });
  });
});
