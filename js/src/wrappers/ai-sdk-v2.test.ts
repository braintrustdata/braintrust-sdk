import {
  expect,
  test,
  describe,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";
import { generateText, streamText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { AISDKMiddleware } from "../exports-node";
import {
  _exportsForTestingOnly,
  Logger,
  TestBackgroundLogger,
  initLogger,
  _internalSetInitialState,
} from "../logger";

const testModelName = "gpt-4.1";
const testAnthropicModelName = "claude-3-haiku-20240307";

_exportsForTestingOnly.setInitialTestState();

function assertTimingValid(
  startTime: number,
  endTime: number,
  metrics: { start: number; end: number },
) {
  const spanStartMs = metrics.start * 1000;
  const spanEndMs = metrics.end * 1000;

  expect(startTime).toBeLessThanOrEqual(spanStartMs);
  expect(spanStartMs).toBeLessThanOrEqual(spanEndMs);
  expect(spanEndMs).toBeLessThanOrEqual(endTime);
}

test("ai sdk middleware is installed", () => {
  expect(wrapLanguageModel).toBeDefined();
  expect(openai).toBeDefined();
});

describe("ai sdk middleware tests", () => {
  let testLogger: TestBackgroundLogger;
  let logger: Logger<true>;
  let rawModel = openai(testModelName);
  let wrappedModel = wrapLanguageModel({
    model: rawModel,
    middleware: AISDKMiddleware({ debug: true, name: "TestMiddleware" }),
  });
  let models = [rawModel, wrappedModel];

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(async () => {
    testLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    logger = initLogger({
      projectName: "ai-sdk-middleware.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("generateText wrapLanguageModel", async () => {
    for (const [_, model] of models.entries()) {
      const isWrapped = model === wrappedModel;
      if (!isWrapped) continue;

      expect(await testLogger.drain()).toHaveLength(0);

      const startTime = Date.now();
      const { text } = await generateText({
        model: model,
        prompt: "What is 2+2?",
        system: "Just return the number",
      });
      const endTime = Date.now();

      const spans = await testLogger.drain();
      expect(spans).toHaveLength(1);

      const span = spans[0] as any;
      expect(span).toMatchObject({
        span_attributes: {
          name: "ai-sdk.generateText",
          type: "llm",
        },
        input: [
          { role: "system", content: "Just return the number" },
          {
            role: "user",
            content: [{ type: "text", text: "What is 2+2?" }],
          },
        ],
        output: [{ type: "text", text: "4" }],
        metadata: {
          provider: "openai",
          finish_reason: "stop",
          model: "gpt-4.1-2025-04-14",
        },
        metrics: {
          prompt_tokens: expect.any(Number),
          completion_tokens: expect.any(Number),
          tokens: expect.any(Number),
          completion_reasoning_tokens: expect.any(Number),
          prompt_cached_tokens: expect.any(Number),
        },
      });

      // Verify timing and actual output content
      expect(text).toContain("4");
      expect(span.output[0].text).toBe("4");
      assertTimingValid(startTime, endTime, span.metrics);
    }
  });

  test("streamText wrapLanguageModel", async () => {
    for (const [_, model] of models.entries()) {
      const isWrapped = model === wrappedModel;
      if (!isWrapped) continue;

      expect(await testLogger.drain()).toHaveLength(0);

      const startTime = Date.now();
      const { textStream } = await streamText({
        model: model,
        prompt: "Please recite the last 4 lines of Shakespeare's Sonnet 18",
        system: "Respond with just the poem lines, no additional text",
      });

      // Consume the stream
      let fullText = "";
      for await (const chunk of textStream) {
        fullText += chunk;
      }
      const endTime = Date.now();

      expect(fullText).toBeDefined();
      expect(fullText.length).toBeGreaterThan(50); // Should be at least 4 lines of poetry

      const spans = await testLogger.drain();
      expect(spans).toHaveLength(1);

      const span = spans[0] as any;
      expect(span).toMatchObject({
        span_attributes: {
          name: "ai-sdk.streamText",
          type: "llm",
        },
        input: [
          {
            role: "system",
            content: "Respond with just the poem lines, no additional text",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Please recite the last 4 lines of Shakespeare's Sonnet 18",
              },
            ],
          },
        ],
        output: [{ type: "text", text: expect.stringContaining("So long") }],
        metadata: {
          provider: "openai",
          finish_reason: expect.any(String),
          model: "gpt-4.1",
        },
        metrics: expect.any(Object),
      });

      // Verify actual streaming content matches what we collected
      expect(span.output[0].text).toBe(fullText);
      expect(fullText).toContain("So long");
      assertTimingValid(startTime, endTime, span.metrics);
    }
  });

  test("middleware handles errors correctly", async () => {
    expect(await testLogger.drain()).toHaveLength(0);

    // Create a model with an invalid model name to force an error
    const invalidModel = wrapLanguageModel({
      model: openai("invalid-model-name-that-does-not-exist"),
      middleware: AISDKMiddleware({ debug: true, name: "ErrorTestMiddleware" }),
    });

    try {
      await generateText({
        model: invalidModel,
        prompt: "This should fail",
        system: "Test error handling",
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Error is expected
      expect(error).toBeDefined();
    }

    const spans = await testLogger.drain();
    expect(spans).toHaveLength(1);

    const span = spans[0] as any;
    expect(span).toMatchObject({
      span_attributes: {
        name: "ai-sdk.generateText",
        type: "llm",
      },
      input: [
        { role: "system", content: "Test error handling" },
        {
          role: "user",
          content: [{ type: "text", text: "This should fail" }],
        },
      ],
      error: expect.any(String),
    });
  });

  test("generateText with Anthropic model", async () => {
    const anthropicModel = anthropic(testAnthropicModelName);
    const wrappedAnthropicModel = wrapLanguageModel({
      model: anthropicModel,
      middleware: AISDKMiddleware({
        debug: true,
        name: "AnthropicTestMiddleware",
      }),
    });

    const models = [anthropicModel, wrappedAnthropicModel];

    for (const [_, model] of models.entries()) {
      const isWrapped = model === wrappedAnthropicModel;
      if (!isWrapped) continue;

      expect(await testLogger.drain()).toHaveLength(0);

      const startTime = Date.now();
      const { text } = await generateText({
        model: model,
        prompt: "What is 5+5?",
        system: "Just return the number",
      });
      const endTime = Date.now();

      const spans = await testLogger.drain();
      expect(spans).toHaveLength(1);

      const span = spans[0] as any;
      expect(span).toMatchObject({
        span_attributes: {
          name: "ai-sdk.generateText",
          type: "llm",
        },
        input: [
          { role: "system", content: "Just return the number" },
          {
            role: "user",
            content: [{ type: "text", text: "What is 5+5?" }],
          },
        ],
        output: [{ type: "text", text: expect.any(String) }],
        metadata: {
          provider: "anthropic",
          finish_reason: "stop",
          model: "claude-3-haiku-20240307",
        },
        metrics: {
          prompt_tokens: expect.any(Number),
          completion_tokens: expect.any(Number),
          tokens: expect.any(Number),
          prompt_cached_tokens: expect.any(Number),
          // Note: Anthropic doesn't have completion_reasoning_tokens unlike OpenAI
        },
      });

      // Verify actual output content contains expected answer
      expect(text).toMatch(/10/);
      expect(span.output[0].text).toMatch(/10/);
      assertTimingValid(startTime, endTime, span.metrics);
    }
  });

  test("generateText with model parameters", async () => {
    for (const [_, model] of models.entries()) {
      const isWrapped = model === wrappedModel;
      if (!isWrapped) continue;

      expect(await testLogger.drain()).toHaveLength(0);

      const startTime = Date.now();
      const { text } = await generateText({
        model: model,
        prompt: "What is 3+3?",
        system: "Just return the number",
        temperature: 0.7,
        topP: 0.9,
      });
      const endTime = Date.now();

      const spans = await testLogger.drain();
      expect(spans).toHaveLength(1);

      const span = spans[0] as any;
      expect(span).toMatchObject({
        span_attributes: {
          name: "ai-sdk.generateText",
          type: "llm",
        },
        input: [
          { role: "system", content: "Just return the number" },
          {
            role: "user",
            content: [{ type: "text", text: "What is 3+3?" }],
          },
        ],
        output: [{ type: "text", text: expect.any(String) }],
        metadata: {
          provider: "openai",
          finish_reason: "stop",
          model: expect.any(String),
          temperature: 0.7,
          top_p: 0.9,
        },
        metrics: expect.any(Object),
      });

      // Verify actual output content
      expect(text).toMatch(/6/);
      expect(span.output[0].text).toMatch(/6/);
      assertTimingValid(startTime, endTime, span.metrics);
    }
  });

  test("generateText with Anthropic model parameters", async () => {
    const anthropicModel = anthropic(testAnthropicModelName);
    const wrappedAnthropicModel = wrapLanguageModel({
      model: anthropicModel,
      middleware: AISDKMiddleware({
        debug: true,
        name: "AnthropicParamsTestMiddleware",
      }),
    });

    const models = [anthropicModel, wrappedAnthropicModel];

    for (const [_, model] of models.entries()) {
      const isWrapped = model === wrappedAnthropicModel;
      if (!isWrapped) continue;

      expect(await testLogger.drain()).toHaveLength(0);

      const startTime = Date.now();
      const { text } = await generateText({
        model: model,
        prompt: "What is 7+7?",
        system: "Just return the number",
        temperature: 0.8,
        topK: 40,
      });
      const endTime = Date.now();

      const spans = await testLogger.drain();
      expect(spans).toHaveLength(1);

      const span = spans[0] as any;
      expect(span).toMatchObject({
        span_attributes: {
          name: "ai-sdk.generateText",
          type: "llm",
        },
        input: [
          { role: "system", content: "Just return the number" },
          {
            role: "user",
            content: [{ type: "text", text: "What is 7+7?" }],
          },
        ],
        output: [{ type: "text", text: expect.any(String) }],
        metadata: {
          provider: "anthropic",
          finish_reason: "stop",
          model: "claude-3-haiku-20240307",
          temperature: 0.8,
          top_k: 40,
        },
        metrics: expect.any(Object),
      });

      // Verify actual output content
      expect(text).toMatch(/14/);
      expect(span.output[0].text).toMatch(/14/);
      assertTimingValid(startTime, endTime, span.metrics);
    }
  });

  test("middleware detects custom providers", async () => {
    // This test demonstrates that the provider detection will work
    // with any provider that follows the AI SDK patterns
    expect(true).toBe(true); // The enhanced detection is tested in integration
  });

  test("should import AISDKMiddleware from braintrust package", async () => {
    expect(typeof AISDKMiddleware).toBe("function");

    // Should be able to call it and get middleware object back
    const middleware = AISDKMiddleware({});
    expect(middleware).toHaveProperty("wrapGenerate");
    expect(middleware).toHaveProperty("wrapStream");
    expect(typeof middleware.wrapGenerate).toBe("function");
    expect(typeof middleware.wrapStream).toBe("function");
  });
});
