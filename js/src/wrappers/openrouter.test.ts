import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { configureNode } from "../node/config";
import { _exportsForTestingOnly, initLogger } from "../logger";
import { wrapOpenRouter } from "./openrouter";

const TEST_MODEL = "openai/gpt-4.1-mini";
const TEST_EMBEDDING_MODEL = "openai/text-embedding-3-small";

try {
  configureNode();
} catch {
  // Best-effort initialization for test environments.
}

describe("openrouter wrapper", () => {
  let backgroundLogger: ReturnType<
    typeof _exportsForTestingOnly.useTestBackgroundLogger
  >;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    initLogger({
      projectName: "openrouter.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
    vi.restoreAllMocks();
  });

  test("returns the original object for unsupported clients", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalid = { foo: "bar" };

    expect(wrapOpenRouter(invalid)).toBe(invalid);
    expect(warnSpy).toHaveBeenCalledWith(
      "Unsupported OpenRouter library. Not wrapping.",
    );
  });

  test("wraps chat.send and emits plugin-consumable channel events", async () => {
    const request = {
      chatGenerationParams: {
        model: TEST_MODEL,
        temperature: 0,
        messages: [{ role: "user", content: "Reply with exactly OK." }],
      },
    };
    const options = { timeoutMs: 1234 };
    const send = vi.fn(async (actualRequest, actualOptions) => {
      expect(actualRequest).toBe(request);
      expect(actualOptions).toBe(options);
      return {
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "OK",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          promptTokens: 5,
          completionTokens: 1,
          totalTokens: 6,
        },
      };
    });

    const client = wrapOpenRouter({
      chat: { send },
      embeddings: { generate: vi.fn() },
    });

    const result = await client.chat.send(request, options);
    expect(result).toMatchObject({
      choices: [
        {
          message: {
            content: "OK",
          },
        },
      ],
    });

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    const span = spans[0] as Record<string, any>;
    expect(span.span_attributes).toMatchObject({
      name: "openrouter.chat.send",
      type: "llm",
    });
    expect(span.input).toEqual(request.chatGenerationParams.messages);
    expect(span.metadata).toMatchObject({
      provider: "openrouter",
      model: TEST_MODEL,
      temperature: 0,
    });
    expect(span.output).toMatchObject([
      {
        message: {
          role: "assistant",
          content: "OK",
        },
      },
    ]);
    expect(span.metrics).toMatchObject({
      prompt_tokens: 5,
      completion_tokens: 1,
      tokens: 6,
    });
  });

  test("wraps streaming chat.send without collecting stream state in the wrapper", async () => {
    async function* stream() {
      yield {
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
      };

      yield {
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
        usage: {
          promptTokens: 7,
          completionTokens: 4,
          totalTokens: 11,
        },
      };
    }

    const send = vi.fn(async () => stream());
    const client = wrapOpenRouter({
      chat: { send },
      embeddings: { generate: vi.fn() },
    });

    const result = await client.chat.send({
      chatGenerationParams: {
        model: TEST_MODEL,
        stream: true,
        messages: [{ role: "user", content: "Use the tool." }],
      },
    });

    const chunks = [];
    for await (const chunk of result as AsyncIterable<unknown>) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    const span = spans[0] as Record<string, any>;
    expect(span.span_attributes.name).toBe("openrouter.chat.send");
    expect(span.output).toMatchObject([
      {
        message: {
          role: "assistant",
          content: "Let me check that.",
          tool_calls: [
            {
              function: {
                name: "lookup_weather",
                arguments: '{"city":"Vienna"}',
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ]);
    expect(span.metrics).toMatchObject({
      time_to_first_token: expect.any(Number),
      prompt_tokens: 7,
      completion_tokens: 4,
      tokens: 11,
    });
  });

  test("wraps responses.send and embeddings.generate", async () => {
    const responsesSend = vi.fn(async () => ({
      id: "resp_123",
      model: TEST_MODEL,
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Observability helps." }],
        },
      ],
      usage: {
        inputTokens: 10,
        outputTokens: 3,
        totalTokens: 13,
      },
    }));
    const embeddingsGenerate = vi.fn(async () => ({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: {
        promptTokens: 4,
        totalTokens: 4,
      },
    }));

    const client = wrapOpenRouter({
      chat: { send: vi.fn() },
      beta: {
        responses: {
          send: responsesSend,
        },
      },
      embeddings: {
        generate: embeddingsGenerate,
      },
    });

    await client.beta.responses.send({
      openResponsesRequest: {
        model: TEST_MODEL,
        input: "Say one short sentence about observability.",
        maxOutputTokens: 16,
      },
    });
    await client.embeddings.generate({
      requestBody: {
        model: TEST_EMBEDDING_MODEL,
        input: "braintrust tracing",
        inputType: "query",
      },
    });

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(2);

    const responseSpan = spans.find(
      (span: any) =>
        span.span_attributes?.name === "openrouter.beta.responses.send",
    ) as Record<string, any> | undefined;
    const embeddingSpan = spans.find(
      (span: any) =>
        span.span_attributes?.name === "openrouter.embeddings.generate",
    ) as Record<string, any> | undefined;

    expect(responseSpan).toBeDefined();
    expect(responseSpan?.metadata).toMatchObject({
      provider: "openrouter",
      model: TEST_MODEL,
      status: "completed",
      id: "resp_123",
    });
    expect(responseSpan?.output).toMatchObject([
      {
        type: "message",
        role: "assistant",
      },
    ]);
    expect(responseSpan?.metrics).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 3,
      tokens: 13,
    });

    expect(embeddingSpan).toBeDefined();
    expect(embeddingSpan?.metadata).toMatchObject({
      provider: "openrouter",
      model: TEST_EMBEDDING_MODEL,
      inputType: "query",
    });
    expect(embeddingSpan?.output).toMatchObject({
      embedding_length: 3,
    });
    expect(embeddingSpan?.metrics).toMatchObject({
      prompt_tokens: 4,
      tokens: 4,
    });
  });

  test("wraps callModel tool execution with tool spans", async () => {
    const callModel = vi.fn((request) => {
      const tool = request.tools[0];
      return tool.function.execute(
        { city: "Vienna" },
        {
          toolCall: {
            id: "call_1",
            name: "lookup_weather",
          },
        },
      );
    });

    const client = wrapOpenRouter({
      callModel,
    });

    const result = await client.callModel({
      model: TEST_MODEL,
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_weather",
            execute: async (params: { city: string }) => ({
              forecast: `Sunny in ${params.city}`,
            }),
          },
        },
      ],
    });

    expect(result).toMatchObject({
      forecast: "Sunny in Vienna",
    });

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

  test("wraps generator tools in callModel and logs the final yielded value", async () => {
    const callModel = vi.fn((request) => {
      const tool = request.tools[0];
      return tool.function.execute(
        { city: "Vienna" },
        {
          toolCall: {
            id: "call_2",
            name: "lookup_weather",
          },
        },
      );
    });

    const client = wrapOpenRouter({
      callModel,
    });

    const result = client.callModel({
      model: TEST_MODEL,
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_weather",
            async *execute(params: { city: string }) {
              yield { status: `Fetching ${params.city}` };
              yield { forecast: `Sunny in ${params.city}` };
            },
          },
        },
      ],
    });

    const chunks = [];
    for await (const chunk of result as AsyncIterable<unknown>) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);

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
    expect(span.output).toMatchObject({
      forecast: "Sunny in Vienna",
    });
  });
});
