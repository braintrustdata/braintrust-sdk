import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { configureNode } from "../../node/config";
import { _exportsForTestingOnly, initLogger } from "../../logger";
import { openRouterChannels } from "./openrouter-channels";
import {
  aggregateOpenRouterChatChunks,
  aggregateOpenRouterResponseStreamEvents,
  parseOpenRouterMetricsFromUsage,
} from "./openrouter-plugin";

try {
  configureNode();
} catch {
  // Best-effort initialization for test environments.
}

describe("OpenRouter Plugin", () => {
  let backgroundLogger: ReturnType<
    typeof _exportsForTestingOnly.useTestBackgroundLogger
  >;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    initLogger({
      projectName: "openrouter-plugin.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
    vi.restoreAllMocks();
  });

  describe("parseOpenRouterMetricsFromUsage", () => {
    it("should parse chat token usage", () => {
      expect(
        parseOpenRouterMetricsFromUsage({
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          promptTokensDetails: {
            cachedTokens: 4,
            cacheWriteTokens: 2,
            audioTokens: 1,
          },
          completionTokensDetails: {
            reasoningTokens: 6,
            acceptedPredictionTokens: 3,
          },
        }),
      ).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        tokens: 30,
        prompt_cached_tokens: 4,
        prompt_cache_write_tokens: 2,
        prompt_audio_tokens: 1,
        completion_reasoning_tokens: 6,
        completion_accepted_prediction_tokens: 3,
      });
    });

    it("should parse responses usage with cost details", () => {
      expect(
        parseOpenRouterMetricsFromUsage({
          inputTokens: 11,
          outputTokens: 7,
          totalTokens: 18,
          cost: 0.0021,
          inputTokensDetails: {
            cachedTokens: 5,
          },
          outputTokensDetails: {
            reasoningTokens: 2,
          },
          costDetails: {
            upstreamInferenceCost: 0.001,
            upstreamInferenceInputCost: 0.0004,
            upstreamInferenceOutputCost: 0.0006,
          },
          isByok: true,
        }),
      ).toEqual({
        prompt_tokens: 11,
        completion_tokens: 7,
        tokens: 18,
        cost: 0.0021,
        prompt_cached_tokens: 5,
        completion_reasoning_tokens: 2,
        cost_upstream_inference_cost: 0.001,
        cost_upstream_inference_input_cost: 0.0004,
        cost_upstream_inference_output_cost: 0.0006,
      });
    });

    it("should ignore non-object usage", () => {
      expect(parseOpenRouterMetricsFromUsage(undefined)).toEqual({});
      expect(parseOpenRouterMetricsFromUsage(null)).toEqual({});
      expect(parseOpenRouterMetricsFromUsage("nope")).toEqual({});
    });
  });

  describe("aggregateOpenRouterChatChunks", () => {
    it("should aggregate assistant content, tool calls, and usage", () => {
      expect(
        aggregateOpenRouterChatChunks([
          {
            choices: [
              {
                delta: {
                  role: "assistant",
                  content: "Hello",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "lookup",
                        arguments: '{"cit',
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  content: " world",
                  tool_calls: [
                    {
                      function: {
                        arguments: 'y":"Vienna"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              promptTokens: 12,
              completionTokens: 8,
              totalTokens: 20,
            },
          },
        ]),
      ).toEqual({
        output: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello world",
              tool_calls: [
                {
                  id: "call_1",
                  index: 0,
                  type: "function",
                  function: {
                    name: "lookup",
                    arguments: '{"city":"Vienna"}',
                  },
                },
              ],
            },
            logprobs: null,
            finish_reason: "tool_calls",
          },
        ],
        metrics: {
          prompt_tokens: 12,
          completion_tokens: 8,
          tokens: 20,
        },
      });
    });

    it("should return an empty assistant message for empty chunks", () => {
      expect(aggregateOpenRouterChatChunks([])).toEqual({
        output: [
          {
            index: 0,
            message: {
              role: undefined,
              content: undefined,
            },
            logprobs: null,
            finish_reason: undefined,
          },
        ],
        metrics: {},
      });
    });

    it("should aggregate actual SDK camelCase chunk shapes", () => {
      expect(
        aggregateOpenRouterChatChunks([
          {
            choices: [
              {
                delta: {
                  role: "assistant",
                  content: "Let me check ",
                  toolCalls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "lookup_weather",
                        arguments: '{"city":"Vie',
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  content: "that.",
                  toolCalls: [
                    {
                      index: 0,
                      function: {
                        arguments: 'nna"}',
                      },
                    },
                  ],
                },
                finishReason: "tool_calls",
              },
            ],
          },
        ]),
      ).toEqual({
        output: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Let me check that.",
              tool_calls: [
                {
                  id: "call_1",
                  index: 0,
                  type: "function",
                  function: {
                    name: "lookup_weather",
                    arguments: '{"city":"Vienna"}',
                  },
                },
              ],
            },
            logprobs: null,
            finish_reason: "tool_calls",
          },
        ],
        metrics: {},
      });
    });
  });

  describe("aggregateOpenRouterResponseStreamEvents", () => {
    it("should use the terminal response payload for output, metrics, and metadata", () => {
      expect(
        aggregateOpenRouterResponseStreamEvents([
          { type: "response.created" },
          {
            type: "response.output_text.delta",
            delta: "Hello",
          },
          {
            type: "response.completed",
            response: {
              id: "resp_123",
              model: "openai/gpt-4.1-mini",
              output: [{ type: "message", role: "assistant" }],
              usage: {
                inputTokens: 9,
                outputTokens: 4,
                totalTokens: 13,
                cost: 0.0012,
                isByok: true,
              },
            },
          },
        ]),
      ).toEqual({
        output: [{ type: "message", role: "assistant" }],
        metrics: {
          prompt_tokens: 9,
          completion_tokens: 4,
          tokens: 13,
          cost: 0.0012,
        },
        metadata: {
          id: "resp_123",
          model: "openai/gpt-4.1-mini",
          is_byok: true,
        },
      });
    });

    it("should ignore non-terminal events", () => {
      expect(
        aggregateOpenRouterResponseStreamEvents([
          { type: "response.created" },
          { type: "response.output_text.delta", delta: "Hello" },
        ]),
      ).toEqual({
        output: undefined,
        metrics: {},
      });
    });
  });

  describe("callModel tool patching", () => {
    it("patches tools on callModel start so auto-instrumentation emits tool spans", async () => {
      const tool = {
        type: "function",
        function: {
          name: "lookup_weather",
          execute: async (params: { city: string }) => ({
            forecast: `Sunny in ${params.city}`,
          }),
        },
      };
      const request = {
        model: "openai/gpt-4.1-mini",
        tools: [tool],
      };
      const event = {
        arguments: [request],
      };
      const tracingChannel = openRouterChannels.callModel.tracingChannel();

      tracingChannel.start!.publish(event);
      expect(request.tools[0]).not.toBe(tool);

      const result = await request.tools[0].function.execute(
        { city: "Vienna" },
        {
          toolCall: {
            id: "call_1",
            name: "lookup_weather",
          },
        },
      );
      expect(result).toMatchObject({
        forecast: "Sunny in Vienna",
      });
      expect(request.tools[0]).not.toBe(tool);

      const spans = await backgroundLogger.drain();
      expect(spans).toHaveLength(1);
      const span = spans[0] as Record<string, any>;
      expect(span.span_attributes).toMatchObject({
        name: "lookup_weather",
        type: "tool",
      });
      expect(span.input).toMatchObject({
        city: "Vienna",
      });
      expect(span.metadata).toMatchObject({
        provider: "openrouter",
        tool_name: "lookup_weather",
        tool_call_id: "call_1",
      });
      expect(span.output).toMatchObject({
        forecast: "Sunny in Vienna",
      });
    });
  });
});
