import { describe, expect, it } from "vitest";
import {
  aggregateChatCompletionChunks,
  extractResponseMetadata,
} from "./huggingface-plugin";

describe("extractResponseMetadata", () => {
  it("keeps allowlisted response fields", () => {
    expect(
      extractResponseMetadata({
        id: "chatcmpl_123",
        object: "chat.completion",
        model: "meta-llama/Llama-3.1-8B-Instruct",
        created: 123,
        usage: { total_tokens: 10 },
        choices: [],
      }),
    ).toEqual({
      created: 123,
      id: "chatcmpl_123",
      model: "meta-llama/Llama-3.1-8B-Instruct",
      object: "chat.completion",
    });
  });
});

describe("aggregateChatCompletionChunks", () => {
  it("merges streamed tool call deltas by tool index", () => {
    expect(
      aggregateChatCompletionChunks([
        {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_1",
                    index: 0,
                    type: "function",
                    function: {
                      name: "get_current_weather",
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
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: '{"location":"San Francisco"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    ).toEqual({
      choices: [
        {
          finish_reason: "tool_calls",
          index: 0,
          message: {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "get_current_weather",
                  arguments: '{"location":"San Francisco"}',
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("keeps tool calls apart when the provider omits index", () => {
    const chunk = (toolCall: Record<string, unknown>) => ({
      choices: [{ delta: { tool_calls: [toolCall] } }],
    });
    const result = aggregateChatCompletionChunks([
      chunk({
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":' },
      }),
      chunk({ function: { arguments: '"Paris"}' } }),
      chunk({
        id: "call_2",
        type: "function",
        function: { name: "get_time", arguments: '{"tz":"CET"}' },
      }),
    ] as any);

    expect(result.choices[0].message.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Paris"}' },
      },
      {
        id: "call_2",
        type: "function",
        function: { name: "get_time", arguments: '{"tz":"CET"}' },
      },
    ]);
  });

  it("preserves full tool calls emitted in a single streamed chunk", () => {
    expect(
      aggregateChatCompletionChunks([
        {
          choices: [
            {
              delta: {
                role: "assistant",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    id: "call_1",
                    index: 0,
                    type: "function",
                    function: {
                      name: "get_current_weather",
                      arguments: '{"location":"San Francisco"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    ).toEqual({
      choices: [
        {
          finish_reason: "tool_calls",
          index: 0,
          message: {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "get_current_weather",
                  arguments: '{"location":"San Francisco"}',
                },
              },
            ],
          },
        },
      ],
    });
  });
});
