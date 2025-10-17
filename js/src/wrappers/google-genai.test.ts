import {
  test,
  assert,
  beforeEach,
  beforeAll,
  afterEach,
  describe,
  expect,
} from "vitest";
import { configureNode } from "../node";
import * as googleGenAI from "@google/genai";
import {
  _exportsForTestingOnly,
  initLogger,
  Logger,
  TestBackgroundLogger,
} from "../logger";
import { wrapGoogleGenAI } from "../exports-node";
import { getCurrentUnixTimestamp } from "../util";

const TEST_MODEL = "gemini-2.0-flash-001";
const TEST_SUITE_OPTIONS = { timeout: 10000, retry: 3 };

try {
  configureNode();
} catch {
  // FIXME[matt] have a better of way of initializing brainstrust state once per process.
}

test("@google/genai is installed", () => {
  assert.ok(googleGenAI);
});

describe("google genai client unit tests", TEST_SUITE_OPTIONS, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let backgroundLogger: TestBackgroundLogger;
  let _logger: Logger<false>;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    const { GoogleGenAI } = wrapGoogleGenAI(googleGenAI);
    client = new GoogleGenAI({
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
    });
    _logger = initLogger({
      projectName: "google-genai.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("google genai basic completion", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const start = getCurrentUnixTimestamp();
    const result = await client.models.generateContent({
      model: TEST_MODEL,
      contents: "What is the capital of France? Answer in one word.",
      config: {
        maxOutputTokens: 100,
      },
    });
    const end = getCurrentUnixTimestamp();
    assert.ok(result);
    assert.ok(result.text);

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
        name: "generate_content",
      },
      metadata: expect.objectContaining({
        model: TEST_MODEL,
      }),
      input: expect.objectContaining({
        model: TEST_MODEL,
        contents: expect.anything(),
      }),
      metrics: expect.objectContaining({
        start: expect.any(Number),
        end: expect.any(Number),
      }),
    });

    const { metrics } = span;
    expect(start).toBeLessThanOrEqual(metrics.start);
    expect(metrics.start).toBeLessThanOrEqual(metrics.end);
    expect(metrics.end).toBeLessThanOrEqual(end);

    expect(metrics.tokens).toBeGreaterThan(0);
    expect(metrics.prompt_tokens).toBeGreaterThan(0);
    expect(metrics.completion_tokens).toBeGreaterThan(0);
  });

  test("google genai streaming completion", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const start = getCurrentUnixTimestamp();
    const stream = await client.models.generateContentStream({
      model: TEST_MODEL,
      contents: "Count from 1 to 5.",
      config: {
        maxOutputTokens: 100,
      },
    });

    let ttft = -1.0;
    let chunkCount = 0;
    for await (const chunk of stream) {
      if (ttft < 0) {
        ttft = getCurrentUnixTimestamp() - start;
      }
      chunkCount++;
      assert.ok(chunk);
    }
    const end = getCurrentUnixTimestamp();

    expect(chunkCount).toBeGreaterThan(0);

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span.span_attributes.name).toBe("generate_content_stream");
    expect(span.span_attributes.type).toBe("llm");

    const { metrics } = span;
    expect(start).toBeLessThanOrEqual(metrics.start);
    expect(metrics.start).toBeLessThanOrEqual(metrics.end);
    expect(metrics.end).toBeLessThanOrEqual(end);
    expect(ttft).toBeGreaterThanOrEqual(metrics.time_to_first_token);

    expect(metrics.tokens).toBeGreaterThan(0);
    expect(metrics.prompt_tokens).toBeGreaterThan(0);
    expect(metrics.completion_tokens).toBeGreaterThan(0);
  });

  test("google genai tool calls", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const getWeatherTool = {
      name: "get_weather",
      description: "Get the current weather for a location.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city and state, e.g. San Francisco, CA",
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "The unit of temperature",
          },
        },
        required: ["location"],
      },
    };

    const startTime = getCurrentUnixTimestamp();
    const result = await client.models.generateContent({
      model: TEST_MODEL,
      contents: "What is the weather like in Paris, France?",
      config: {
        tools: [{ functionDeclarations: [getWeatherTool] }],
        maxOutputTokens: 500,
      },
    });
    const endTime = getCurrentUnixTimestamp();

    assert.ok(result);

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
        name: "generate_content",
      },
      metadata: expect.objectContaining({
        model: TEST_MODEL,
      }),
      input: expect.objectContaining({
        model: TEST_MODEL,
        contents: expect.anything(),
        config: expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              functionDeclarations: expect.arrayContaining([
                expect.objectContaining({
                  name: "get_weather",
                }),
              ]),
            }),
          ]),
        }),
      }),
      metrics: expect.objectContaining({
        start: expect.any(Number),
        end: expect.any(Number),
      }),
    });

    const { metrics } = span;
    expect(startTime).toBeLessThanOrEqual(metrics.start);
    expect(metrics.start).toBeLessThanOrEqual(metrics.end);
    expect(metrics.end).toBeLessThanOrEqual(endTime);

    expect(metrics.tokens).toBeGreaterThan(0);
    expect(metrics.prompt_tokens).toBeGreaterThan(0);

    if (result.functionCalls && result.functionCalls.length > 0) {
      const functionCall = result.functionCalls[0];
      expect(functionCall.name).toBe("get_weather");
      expect(functionCall.args).toBeDefined();
    }
  });

  test("google genai multi-tool calls", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const tools = [
      {
        name: "get_weather",
        description: "Get the weather for a location",
        parametersJsonSchema: {
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
      {
        name: "get_time",
        description: "Get the current time for a timezone",
        parametersJsonSchema: {
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
    ];

    const startTime = getCurrentUnixTimestamp();
    const result = await client.models.generateContent({
      model: TEST_MODEL,
      contents:
        "What's the weather in New York and the time in Tokyo? Call the appropriate tools.",
      config: {
        tools: [{ functionDeclarations: tools }],
        maxOutputTokens: 500,
      },
    });
    const endTime = getCurrentUnixTimestamp();

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span).toMatchObject({
      span_attributes: {
        type: "llm",
        name: "generate_content",
      },
      metadata: expect.objectContaining({
        model: TEST_MODEL,
      }),
    });

    const { metrics } = span;
    expect(startTime).toBeLessThanOrEqual(metrics.start);
    expect(metrics.start).toBeLessThanOrEqual(metrics.end);
    expect(metrics.end).toBeLessThanOrEqual(endTime);

    expect(metrics.tokens).toBeGreaterThan(0);
    expect(metrics.prompt_tokens).toBeGreaterThan(0);

    if (result.functionCalls) {
      expect(result.functionCalls.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolNames = result.functionCalls.map((call: any) => call.name);
      expect(toolNames).toContain("get_weather");
    }
  });

  test("google genai system instruction", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const result = await client.models.generateContent({
      model: TEST_MODEL,
      contents: "Tell me about the weather.",
      config: {
        systemInstruction: "You are a pirate. Always respond in pirate speak.",
        maxOutputTokens: 150,
      },
    });

    assert.ok(result);
    assert.ok(result.text);

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span.metadata).toMatchObject({
      model: TEST_MODEL,
      systemInstruction: "You are a pirate. Always respond in pirate speak.",
    });
  });

  test("google genai multi-turn conversation", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const result = await client.models.generateContent({
      model: TEST_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: "Hi, my name is Alice." }],
        },
        {
          role: "model",
          parts: [{ text: "Hello Alice! Nice to meet you." }],
        },
        {
          role: "user",
          parts: [{ text: "What did I just tell you my name was?" }],
        },
      ],
      config: {
        maxOutputTokens: 200,
      },
    });

    assert.ok(result);
    assert.ok(result.text);
    expect(result.text.toLowerCase()).toContain("alice");

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span.input.contents).toHaveLength(3);
    expect(span.metrics.tokens).toBeGreaterThan(0);
  });
});
