import {
  test,
  assert,
  beforeEach,
  beforeAll,
  afterEach,
  describe,
  expect,
  vi,
} from "vitest";
import { configureNode } from "../node";
import OpenAI from "openai";
import {
  _exportsForTestingOnly,
  initLogger,
  Logger,
  TestBackgroundLogger,
} from "../logger";
import { wrapOpenAI } from "../exports-node";
import { getCurrentUnixTimestamp } from "../util";
import { parseMetricsFromUsage } from "./oai_responses";

// use the cheapest model for tests
const TEST_MODEL = "gpt-4o-mini";
const TEST_SUITE_OPTIONS = { timeout: 10000, retry: 3 };

try {
  configureNode();
} catch {
  // FIXME[matt] have a better of way of initializing brainstrust state once per process.
}

test("openai is installed", () => {
  assert.ok(OpenAI);
});

describe("openai client unit tests", TEST_SUITE_OPTIONS, () => {
  let oai: OpenAI;
  let client: OpenAI;
  let backgroundLogger: TestBackgroundLogger;
  let _logger: Logger<false>;

  // fake login before we test. once is enough.
  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    oai = new OpenAI();
    client = wrapOpenAI(oai);
    _logger = initLogger({
      projectName: "openai.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("openai.chat.completions.streaming", async (context) => {
    assert.lengthOf(await backgroundLogger.drain(), 0);

    for (const includeUsage of [false, true]) {
      const start = getCurrentUnixTimestamp();
      const stream = await client.chat.completions.create({
        messages: [{ role: "user", content: "1+1" }],
        model: TEST_MODEL,
        stream: true,
        stream_options: {
          include_usage: includeUsage,
        },
      });

      let ttft = -1.0;
      for await (const event of stream) {
        if (ttft < 0) {
          ttft = getCurrentUnixTimestamp() - start;
        }
        assert.ok(event);
      }
      const end = getCurrentUnixTimestamp();

      const spans = await backgroundLogger.drain();
      assert.lengthOf(spans, 1);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
      const span = spans[0] as any;
      assert.equal(span.span_attributes.name, "Chat Completion");
      assert.equal(span.span_attributes.type, "llm");
      const m = span.metrics;
      assert.isTrue(start <= m.start && m.start < m.end && m.end <= end);
      assert.isTrue(ttft >= m.time_to_first_token);
      if (includeUsage) {
        assert.isTrue(m.tokens > 0);
        assert.isTrue(m.prompt_tokens > 0);
        assert.isTrue(m.time_to_first_token > 0);
        assert.isTrue(m.prompt_cached_tokens >= 0);
        assert.isTrue(m.completion_reasoning_tokens >= 0);
      } else {
        assert.isTrue(m.tokens === undefined);
      }
    }
  });

  test("openai.chat.completions", async (context) => {
    assert.lengthOf(await backgroundLogger.drain(), 0);

    const start = getCurrentUnixTimestamp();
    const result = await client.chat.completions.create({
      messages: [
        {
          role: "user",
          content: "Hello! Can you tell me a joke?",
        },
      ],
      model: TEST_MODEL,
      max_tokens: 100,
    });
    const end = getCurrentUnixTimestamp();
    assert.ok(result);

    const spans = await backgroundLogger.drain();
    assert.lengthOf(spans, 1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;
    assert.ok(span);
    assert.equal(span.span_attributes.type, "llm");
    assert.equal(span.metadata.model, TEST_MODEL);
    assert.equal(span.metadata.provider, "openai");
    const m = span.metrics;
    assert.isTrue(start <= m.start && m.start < m.end && m.end <= end);
    assert.isTrue(m.tokens > 0);
    assert.isTrue(m.prompt_tokens > 0);
    assert.isTrue(m.time_to_first_token > 0);
    assert.isTrue(m.prompt_cached_tokens >= 0);
    assert.isTrue(m.completion_reasoning_tokens >= 0);
  });

  test("openai.chat.completions.tools", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    // Define tools that can be called in parallel
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "get_weather",
          description: "Get the weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The location to get weather for",
              },
            },
            required: ["location"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "get_time",
          description: "Get the current time for a timezone",
          parameters: {
            type: "object",
            properties: {
              timezone: {
                type: "string",
                description: "The timezone to get time for",
              },
            },
            required: ["timezone"],
          },
        },
      },
    ];

    for (const stream of [false, true]) {
      const startTime = getCurrentUnixTimestamp();

      const result = await client.chat.completions.create({
        messages: [
          {
            role: "user",
            content: "What's the weather in New York and the time in Tokyo?",
          },
        ],
        model: TEST_MODEL,
        tools: tools,
        temperature: 0,
        stream: stream,
        stream_options: stream ? { include_usage: true } : undefined,
      });

      if (stream) {
        // Consume the stream
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
        for await (const _chunk of result as any) {
          // Exhaust the stream
        }
      }

      const endTime = getCurrentUnixTimestamp();

      const spans = await backgroundLogger.drain();
      expect(spans).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
      const span = spans[0] as any;

      expect(span).toMatchObject({
        project_id: expect.any(String),
        log_id: expect.any(String),
        created: expect.any(String),
        span_id: expect.any(String),
        root_span_id: expect.any(String),
        span_attributes: {
          type: "llm",
          name: "Chat Completion",
        },
        metadata: {
          model: TEST_MODEL,
          provider: "openai",
          stream: stream,
          tools: expect.arrayContaining([
            expect.objectContaining({
              type: "function",
              function: expect.objectContaining({
                name: "get_weather",
              }),
            }),
            expect.objectContaining({
              type: "function",
              function: expect.objectContaining({
                name: "get_time",
              }),
            }),
          ]),
        },
        input: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "What's the weather in New York and the time in Tokyo?",
          }),
        ]),
        metrics: expect.objectContaining({
          start: expect.any(Number),
          end: expect.any(Number),
        }),
      });

      // Verify tool calls are in the output
      if (span.output && Array.isArray(span.output)) {
        const message = span.output[0]?.message;
        if (message?.tool_calls) {
          expect(message.tool_calls).toHaveLength(2);
          const tool_names = message.tool_calls.map(
            (call: { function: { name: string } }) => call.function.name,
          );
          expect(tool_names).toContain("get_weather");
          expect(tool_names).toContain("get_time");
        }
      }

      // Validate timing
      const { metrics } = span;
      expect(startTime).toBeLessThanOrEqual(metrics.start);
      expect(metrics.start).toBeLessThanOrEqual(metrics.end);
      expect(metrics.end).toBeLessThanOrEqual(endTime);

      // Token metrics might be available depending on the response
      if (metrics.tokens !== undefined) {
        expect(metrics.tokens).toBeGreaterThan(0);
        expect(metrics.prompt_tokens).toBeGreaterThan(0);
        expect(metrics.prompt_cached_tokens).toBeGreaterThanOrEqual(0);
        expect(metrics.completion_reasoning_tokens).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("openai.responses.stream", async (context) => {
    if (!oai.responses) {
      context.skip();
    }
    assert.lengthOf(await backgroundLogger.drain(), 0);

    const onEvent = vi.fn();
    const onDelta = vi.fn();
    const onIteration = vi.fn();

    const start = getCurrentUnixTimestamp();
    const stream = await client.responses
      .stream({
        model: TEST_MODEL,
        input: "What is 6x6?",
      })
      .on("event", onEvent)
      .on("response.output_text.delta", onDelta);

    for await (const event of stream) {
      onIteration(event);
      assert.ok(event);
    }
    const end = getCurrentUnixTimestamp();

    // make sure we don't break the API.
    expect(onEvent).toHaveBeenCalled();
    expect(onDelta).toHaveBeenCalled();
    expect(onIteration).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await stream.finalResponse();
    expect(result.output[0].content[0].text).toContain("36");

    const spans = await backgroundLogger.drain();
    assert.lengthOf(spans, 1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;
    assert.equal(span.span_attributes.name, "openai.responses.create");
    assert.equal(span.span_attributes.type, "llm");
    assert.equal(span.input[0].content, "What is 6x6?");
    assert.equal(span.metadata.model, TEST_MODEL);
    assert.equal(span.metadata.provider, "openai");
    expect(span.output).toContain("36");

    const m = span.metrics;
    assert.isTrue(start <= m.start && m.start < m.end && m.end <= end);
    assert.isTrue(m.tokens > 0);
    assert.isTrue(m.prompt_tokens > 0);
    assert.isTrue(m.time_to_first_token > 0);
    assert.isTrue(m.prompt_cached_tokens >= 0);
    assert.isTrue(m.completion_reasoning_tokens >= 0);
  });

  test("openai.responses.create(stream=true)", async (context) => {
    if (!oai.responses) {
      context.skip();
    }

    assert.lengthOf(await backgroundLogger.drain(), 0);

    const start = getCurrentUnixTimestamp();
    const stream = await client.responses.create({
      model: TEST_MODEL,
      input: "Read me a few lines of Sonnet 18",
      instructions: "the whole poem, strip punctuation",
      stream: true,
      temperature: 0.5,
    });

    assert.ok(stream);

    for await (const event of stream) {
      assert.ok(event);
      continue;
    }
    const end = getCurrentUnixTimestamp();

    const spans = await backgroundLogger.drain();
    assert.lengthOf(spans, 1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;
    assert.equal(span.span_attributes.name, "openai.responses.create");
    assert.equal(span.span_attributes.type, "llm");
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const input = span.input as any[];
    assert.lengthOf(input, 2);
    assert.equal(input[0].content, "Read me a few lines of Sonnet 18");
    assert.equal(input[0].role, "user");
    assert.equal(input[1].content, "the whole poem, strip punctuation");
    assert.equal(input[1].role, "system");
    assert.equal(span.metadata.model, TEST_MODEL);
    assert.equal(span.metadata.provider, "openai");
    assert.equal(span.metadata.temperature, 0.5);
    // This line takes the output text, converts it to lowercase, and removes all characters
    // except letters, numbers and whitespace using a regex
    assert.isString(span.output);
    const output = span.output.toLowerCase().replace(/[^\w\s]/g, "");

    expect(output).toContain("shall i compare thee");
    const m = span.metrics;
    assert.isTrue(m.tokens > 0);
    assert.isTrue(m.prompt_tokens > 0);
    assert.isTrue(start <= m.start && m.start < m.end && m.end <= end);
    assert.isTrue(m.time_to_first_token > 0);
  });

  test("openai.responses.create(stream=false)", async (context) => {
    if (!oai.responses) {
      context.skip();
    }

    assert.lengthOf(await backgroundLogger.drain(), 0);

    const start = getCurrentUnixTimestamp();
    const response = await client.responses.create({
      model: TEST_MODEL,
      input: "What is the capital of France?",
    });
    const end = getCurrentUnixTimestamp();

    assert.ok(response);
    expect(response.output_text).toContain("Paris");

    const spans = await backgroundLogger.drain();
    assert.lengthOf(spans, 1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;
    assert.equal(span.span_attributes.name, "openai.responses.create");
    assert.equal(span.span_attributes.type, "llm");
    assert.equal(span.input[0].content, "What is the capital of France?");
    assert.equal(span.metadata.model, TEST_MODEL);
    assert.equal(span.metadata.provider, "openai");
    expect(span.output).toContain("Paris");
    const m = span.metrics;
    assert.isTrue(m.tokens > 0);
    assert.isTrue(m.prompt_tokens > 0);
    assert.isTrue(start <= m.start && m.start < m.end && m.end <= end);
  });
});

test("parseMetricsFromUsage", () => {
  const usage = {
    input_tokens: 14,
    output_tokens: 8,
    input_tokens_details: { cached_tokens: 0, brand_new_token: 12 },
  };
  const metrics = parseMetricsFromUsage(usage);
  assert.equal(metrics.prompt_tokens, 14);
  assert.equal(metrics.prompt_cached_tokens, 0);
  assert.equal(metrics.prompt_brand_new_token, 12);
  assert.equal(metrics.completion_tokens, 8);
  // test a bunch of error conditions
  const totallyBadInputs = [
    null,
    undefined,
    "not an object",
    {},
    { input_tokens: "not a number" },
    { input_tokens_details: "not an object" },
    { input_tokens_details: {} },
    { input_tokens_details: { cached_tokens: "not a number" } },
    { input_tokens_details: { cached_tokens: null } },
    { input_tokens_details: { cached_tokens: undefined } },
  ];
  for (const input of totallyBadInputs) {
    assert.deepEqual(parseMetricsFromUsage(input), {});
  }
});
