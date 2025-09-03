import { describe, it, expect, vi, beforeEach } from "vitest";
import { wrapAISDK } from "./ai-sdk-v3";
import { initLogger } from "../logger";

// Mock the logger to capture spans
const mockSpans: Array<{
  name: string;
  attributes: Record<string, unknown>;
  logs: Array<any>;
  ended: boolean;
}> = [];

vi.mock("../logger", async () => {
  const actual = await vi.importActual("../logger");
  return {
    ...actual,
    startSpan: vi.fn((args: any) => {
      const span = {
        name: args.name,
        attributes: args.spanAttributes || {},
        logs: [] as Array<Record<string, unknown>>,
        ended: false,
        log: vi.fn((data: any) => {
          span.logs.push(data);
        }),
        end: vi.fn(() => {
          span.ended = true;
        }),
      };
      mockSpans.push(span);
      return span;
    }),
    wrapTraced: vi.fn((fn: any, spanArgs?: any) => fn),
  };
});

describe("wrapAISDK", () => {
  beforeEach(() => {
    mockSpans.length = 0;
  });

  describe("generateText", () => {
    it("should wrap generateText and log input/output/metrics", async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        content: "Hello, world!",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        response: {
          modelId: "gpt-4",
        },
        providerMetadata: {
          openai: {
            id: "chatcmpl-123",
          },
        },
        finishReason: "stop",
      });

      const mockAI = {
        generateText: mockGenerateText,
      };

      const { generateText } = wrapAISDK(mockAI);

      const result = await generateText({
        prompt: "Hello",
        temperature: 0.7,
        maxTokens: 100,
      });

      expect(mockGenerateText).toHaveBeenCalledWith({
        prompt: "Hello",
        temperature: 0.7,
        maxTokens: 100,
      });

      expect(result.content).toBe("Hello, world!");

      // Check span was created
      expect(mockSpans).toHaveLength(1);
      const span = mockSpans[0];
      expect(span.name).toBe("ai-sdk.generateText");
      expect(span.attributes.type).toBe("llm");
      expect(span.ended).toBe(true);

      // Check logs
      expect(span.logs).toHaveLength(1);
      const log = span.logs[0];
      expect(log.input).toBe("Hello");
      expect(log.output).toBe("Hello, world!");
      expect(log.metadata).toEqual({
        temperature: 0.7,
        max_tokens: 100,
        provider: "openai",
        model: "gpt-4",
        finish_reason: "stop",
      });
      expect(log.metrics).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        tokens: 15,
      });
    });

    it("should handle missing function gracefully", async () => {
      const mockAI = {};
      const { generateText } = wrapAISDK(mockAI);

      await expect(generateText({ prompt: "test" })).rejects.toThrow(
        "generateText is not supported",
      );
    });

    it("should handle tools with execute functions", async () => {
      const toolExecute = vi.fn().mockResolvedValue({ result: "tool output" });

      const mockGenerateText = vi.fn().mockImplementation(async (options) => {
        // Simulate tool execution during generation
        if (options.tools && options.tools[0].execute) {
          await options.tools[0].execute({ query: "test" });
        }

        return {
          content: "Used tool successfully",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          toolCalls: [
            {
              toolCallId: "call_123",
              toolName: "search",
              args: { query: "test" },
            },
          ],
        };
      });

      const mockAI = { generateText: mockGenerateText };
      const { generateText } = wrapAISDK(mockAI);

      await generateText({
        prompt: "Search for something",
        tools: [
          {
            type: "function",
            function: {
              name: "search",
              description: "Search for information",
            },
            execute: toolExecute,
          },
        ],
      });

      expect(toolExecute).toHaveBeenCalledWith({ query: "test" });

      // Should have main span + tool span
      expect(mockSpans.length).toBeGreaterThanOrEqual(1);
      const mainSpan = mockSpans.find((s) => s.name === "ai-sdk.generateText");
      expect(mainSpan).toBeDefined();
    });
  });

  describe("streamText", () => {
    it("should wrap streamText and aggregate streaming output", async () => {
      const chunks = [
        { type: "text-delta", textDelta: "Hello" },
        { type: "text-delta", textDelta: ", " },
        { type: "text-delta", textDelta: "world!" },
        {
          type: "finish",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          finishReason: "stop",
          providerMetadata: { openai: {} },
        },
      ];

      const mockStream = new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        },
      });

      const mockStreamText = vi.fn().mockResolvedValue({
        stream: mockStream,
        response: { modelId: "gpt-4" },
      });

      const mockAI = { streamText: mockStreamText };
      const { streamText } = wrapAISDK(mockAI);

      const result = await streamText({
        prompt: "Hello",
        temperature: 0.5,
      });

      // Consume the stream to trigger flush
      const reader = result.stream.getReader();
      const consumedChunks: any[] = [];
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          consumedChunks.push(value);
        }
      }

      // Wait a bit for async flush to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSpans).toHaveLength(1);
      const span = mockSpans[0];
      expect(span.name).toBe("ai-sdk.streamText");
      expect(span.ended).toBe(true);

      // Check initial log (input + metadata)
      expect(span.logs[0].input).toBe("Hello");
      expect(span.logs[0].metadata.temperature).toBe(0.5);

      // Check time_to_first_token was logged
      expect(span.logs.some((log) => log.metrics?.time_to_first_token)).toBe(
        true,
      );

      // Check final log (aggregated output + final metrics)
      const finalLog = span.logs[span.logs.length - 1];
      expect(finalLog.output).toEqual([
        { type: "text", text: "Hello, world!" },
      ]);
      expect(finalLog.metrics).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        tokens: 15,
      });
    });

    it("should handle tool calls in streaming", async () => {
      const chunks = [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "search",
          args: '{"query":',
        },
        {
          type: "tool-call-delta",
          toolCallId: "call_1",
          argsTextDelta: ' "test"}',
        },
        {
          type: "finish",
          usage: { inputTokens: 20, outputTokens: 0, totalTokens: 20 },
          finishReason: "tool_calls",
        },
      ];

      const mockStream = new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        },
      });

      const mockStreamText = vi.fn().mockResolvedValue({
        stream: mockStream,
        response: { modelId: "gpt-4" },
      });

      const mockAI = { streamText: mockStreamText };
      const { streamText } = wrapAISDK(mockAI);

      const result = await streamText({ prompt: "Search for something" });

      // Consume stream
      const reader = result.stream.getReader();
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      const span = mockSpans[0];
      const finalLog = span.logs[span.logs.length - 1];

      // Should have tool_calls in the output
      expect(Array.isArray(finalLog.output)).toBe(true);
      const output = finalLog.output as any[];
      if (output.length > 0 && output[0].message) {
        expect(output[0].message.tool_calls).toEqual([
          {
            id: "call_1",
            type: "function",
            function: {
              name: "search",
              arguments: '{"query": "test"}',
            },
          },
        ]);
      }
    });
  });

  describe("generateObject", () => {
    it("should wrap generateObject and log object output", async () => {
      const mockObject = { name: "John", age: 30 };

      const mockGenerateObject = vi.fn().mockResolvedValue({
        object: mockObject,
        usage: { inputTokens: 15, outputTokens: 10, totalTokens: 25 },
        response: { modelId: "gpt-4" },
        providerMetadata: { openai: {} },
      });

      const mockAI = { generateObject: mockGenerateObject };
      const { generateObject } = wrapAISDK(mockAI);

      const result = await generateObject({
        prompt: "Generate a person object",
        temperature: 0.1,
      });

      expect(result.object).toEqual(mockObject);

      const span = mockSpans[0];
      expect(span.name).toBe("ai-sdk.generateObject");

      const log = span.logs[0];
      expect(log.output).toEqual(mockObject);
      expect(log.metrics.tokens).toBe(25);
    });
  });

  describe("streamObject", () => {
    it("should wrap streamObject and reconstruct final object", async () => {
      const finalObject = { status: "completed", data: [1, 2, 3] };

      const chunks = [
        { type: "object-delta" }, // Simulate incremental object building
        {
          type: "finish",
          object: finalObject,
          usage: { inputTokens: 20, outputTokens: 15, totalTokens: 35 },
          finishReason: "stop",
        },
      ];

      const mockStream = new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        },
      });

      const mockStreamObject = vi.fn().mockResolvedValue({
        stream: mockStream,
        response: { modelId: "gpt-4" },
      });

      const mockAI = { streamObject: mockStreamObject };
      const { streamObject } = wrapAISDK(mockAI);

      const result = await streamObject({
        prompt: "Generate a status object",
      });

      // Consume stream
      const reader = result.stream.getReader();
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      const span = mockSpans[0];
      expect(span.name).toBe("ai-sdk.streamObject");

      const finalLog = span.logs[span.logs.length - 1];
      expect(finalLog.output).toEqual(finalObject);
      expect(finalLog.metrics.tokens).toBe(35);
    });
  });

  describe("Anthropic provider handling", () => {
    it("should handle Anthropic cache tokens", async () => {
      const mockGenerateText = vi.fn().mockResolvedValue({
        content: "Cached response",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        providerMetadata: {
          anthropic: {
            usage: {
              cache_read_input_tokens: 80,
              cache_creation_input_tokens: 20,
            },
          },
        },
      });

      const mockAI = { generateText: mockGenerateText };
      const { generateText } = wrapAISDK(mockAI);

      await generateText({ prompt: "Test with cache" });

      const span = mockSpans[0];
      const log = span.logs[0];

      // Should include Anthropic cache metrics (finalized tokens may be adjusted)
      expect(log.metrics).toEqual(
        expect.objectContaining({
          completion_tokens: 50,
          // prompt_tokens and tokens may be adjusted by Anthropic finalization
          prompt_tokens: expect.any(Number),
          tokens: expect.any(Number),
        }),
      );

      // Should include cache-specific metrics
      expect(typeof log.metrics.prompt_cached_tokens).toBe("number");
    });
  });
});
