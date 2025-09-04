import { describe, it, expect, vi } from "vitest";

import {
  detectProviderFromResult,
  extractModelFromResult,
  camelToSnake,
  extractModelParameters,
  getNumberProperty,
  normalizeUsageMetrics,
  buildAssistantOutputFromSteps,
  normalizeFinishReason,
  extractToolCallsFromSteps,
  buildAssistantOutputWithToolCalls,
  extractToolCallsFromBlocks,
  extractToolResultChoicesFromSteps,
  extractFinalAssistantTextChoice,
  wrapTools,
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

  describe("buildAssistantOutputFromSteps", () => {
    it("builds headers, tool results, and final text (concise, anonymized)", () => {
      const CALL_1 = "call_1";
      const CALL_2 = "call_2";
      const ISO = "2025-09-04T15:50:25.962Z";

      const steps = [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: CALL_1,
              toolName: "get_time_utc",
              input: {},
            },
            {
              type: "tool-result",
              toolCallId: CALL_1,
              toolName: "get_time_utc",
              output: { now: ISO },
            },
          ],
          finishReason: "tool-calls",
        },
        {
          content: [
            {
              type: "tool-call",
              toolCallId: CALL_2,
              toolName: "format_time",
              input: { iso: ISO, style: "short" },
            },
            {
              type: "tool-result",
              toolCallId: CALL_2,
              toolName: "format_time",
              output: {
                formatted: "UTC time is Thu, 04 Sep 2025 15:50:25 GMT",
              },
            },
          ],
          finishReason: "tool-calls",
        },
        {
          content: [
            {
              type: "text",
              text: "UTC time is Thu, 04 Sep 2025 15:50:25 GMT.",
            },
          ],
          finishReason: "stop",
        },
      ];

      const out = buildAssistantOutputFromSteps({} as any, steps as any);

      const expected = [
        {
          index: 0,
          logprobs: null,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: CALL_1,
                type: "function",
                index: 0,
                function: { name: "get_time_utc", arguments: "{}" },
              },
            ],
          },
        },
        {
          index: 0,
          logprobs: null,
          message: {
            role: "tool",
            tool_call_id: CALL_1,
            content: JSON.stringify({ now: ISO }),
          },
        },
        {
          index: 0,
          logprobs: null,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: CALL_2,
                type: "function",
                index: 0,
                function: {
                  name: "format_time",
                  arguments: JSON.stringify({ iso: ISO, style: "short" }),
                },
              },
            ],
          },
        },
        {
          index: 0,
          logprobs: null,
          message: {
            role: "tool",
            tool_call_id: CALL_2,
            content: JSON.stringify({
              formatted: "UTC time is Thu, 04 Sep 2025 15:50:25 GMT",
            }),
          },
        },
        {
          index: 0,
          logprobs: null,
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "UTC time is Thu, 04 Sep 2025 15:50:25 GMT.",
              },
            ],
          },
        },
      ];

      expect(out).toEqual(expected);
    });

    it("falls back to result.text when steps are empty", () => {
      const result = { finishReason: "stop", text: "Done." };
      const out = buildAssistantOutputFromSteps(result as any, undefined);

      const expected = [
        {
          index: 0,
          logprobs: null,
          finish_reason: "stop",
          message: { role: "assistant", tool_calls: undefined },
        },
        {
          index: 0,
          logprobs: null,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Done." }],
          },
        },
      ];

      expect(out).toEqual(expected);
    });

    it("stringifies tool-result when wrapped as type=json", () => {
      const steps = [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call_json",
              toolName: "x",
              input: {},
            },
            {
              type: "tool-result",
              toolCallId: "call_json",
              toolName: "x",
              output: { type: "json", value: { ok: true } },
            },
          ],
          finishReason: "tool-calls",
        },
      ];
      const out = buildAssistantOutputFromSteps({} as any, steps as any);

      const expected = [
        {
          index: 0,
          logprobs: null,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "call_json",
                type: "function",
                index: 0,
                function: { name: "x", arguments: "{}" },
              },
            ],
          },
        },
        {
          index: 0,
          logprobs: null,
          message: {
            role: "tool",
            tool_call_id: "call_json",
            content: JSON.stringify({ ok: true }),
          },
        },
      ];

      expect(out).toEqual(expected);
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

    it("extracts tool-result choices with string and JSON outputs", () => {
      const steps = [
        {
          content: [
            {
              type: "tool-result",
              toolCallId: "a",
              toolName: "A",
              output: { ok: true },
            },
            {
              type: "tool-result",
              toolCallId: "b",
              toolName: "B",
              output: "raw",
            },
            {
              type: "tool-result",
              toolCallId: "c",
              toolName: "C",
              output: { type: "json", value: { v: 1 } },
            },
          ],
        },
      ];
      const choices = extractToolResultChoicesFromSteps(steps as any);
      expect(choices).toEqual([
        {
          index: 0,
          logprobs: null,
          message: {
            role: "tool",
            tool_call_id: "a",
            content: JSON.stringify({ ok: true }),
          },
        },
        {
          index: 0,
          logprobs: null,
          message: { role: "tool", tool_call_id: "b", content: "raw" },
        },
        {
          index: 0,
          logprobs: null,
          message: {
            role: "tool",
            tool_call_id: "c",
            content: JSON.stringify({ v: 1 }),
          },
        },
      ]);
    });

    it("extractFinalAssistantTextChoice prefers text block over result.text and returns undefined when absent", () => {
      const steps = [{ content: [{ type: "text", text: "Hello" }] }];
      expect(extractFinalAssistantTextChoice(steps as any, "ignored")).toEqual({
        index: 0,
        logprobs: null,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
        },
      });

      expect(extractFinalAssistantTextChoice([], "fallback")).toEqual({
        index: 0,
        logprobs: null,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "fallback" }],
        },
      });

      expect(
        extractFinalAssistantTextChoice(undefined, undefined),
      ).toBeUndefined();
    });
  });
});
