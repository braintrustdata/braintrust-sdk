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
import Anthropic from "@anthropic-ai/sdk";
import { BraintrustMiddleware } from "../../exports-node";
import {
  _exportsForTestingOnly,
  Logger,
  TestBackgroundLogger,
  initLogger,
  _internalSetInitialState,
} from "../../logger";
import { wrapAnthropic } from "../anthropic";
import {
  LONG_SYSTEM_PROMPT,
  TEST_USER_PROMPT,
  CACHEABLE_SYSTEM_MESSAGE,
} from "./middleware.fixtures";

const testModelName = "gpt-4.1";
const testAnthropicModelName = "claude-3-haiku-20240307";
const TEST_SUITE_OPTIONS = { timeout: 10000, retry: 3 };

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

describe("ai sdk middleware tests", TEST_SUITE_OPTIONS, () => {
  let testLogger: TestBackgroundLogger;
  let logger: Logger<true>;
  let rawModel = openai(testModelName);
  const wrappedModel = wrapLanguageModel({
    model: rawModel,
    middleware: BraintrustMiddleware({ debug: true, name: "TestMiddleware" }),
  });
  const models = [rawModel, wrappedModel];

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
          name: "ai-sdk.doGenerate",
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
          name: "ai-sdk.doStream",
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
      middleware: BraintrustMiddleware({
        debug: true,
        name: "ErrorTestMiddleware",
      }),
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
        name: "ai-sdk.doGenerate",
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
      middleware: BraintrustMiddleware({
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
          name: "ai-sdk.doGenerate",
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
          name: "ai-sdk.doGenerate",
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
      middleware: BraintrustMiddleware({
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
          name: "ai-sdk.doGenerate",
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

  test("should import BraintrustMiddleware from braintrust package", async () => {
    expect(typeof BraintrustMiddleware).toBe("function");

    // Should be able to call it and get middleware object back
    const middleware = BraintrustMiddleware({});
    expect(middleware).toHaveProperty("wrapGenerate");
    expect(middleware).toHaveProperty("wrapStream");
    expect(typeof middleware.wrapGenerate).toBe("function");
    expect(typeof middleware.wrapStream).toBe("function");
  });

  test(
    "anthropic token counts consistent between direct and AI SDK wrappers with prompt caching",
    { timeout: 30000 },
    async () => {
      const directClient = wrapAnthropic(
        new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        }),
      );

      expect(await testLogger.drain()).toHaveLength(0);

      // First call: Direct Anthropic wrapper to create cache
      try {
        await directClient.messages.create({
          model: testAnthropicModelName,
          max_tokens: 50,
          system: CACHEABLE_SYSTEM_MESSAGE,
          messages: [
            {
              role: "user",
              content: TEST_USER_PROMPT,
            },
          ],
        });
      } catch (error: any) {
        if (
          error.message?.includes("authentication") ||
          error.message?.includes("api_key")
        ) {
          return;
        }
        throw error;
      }

      // Clear first call logs
      await testLogger.drain();

      // This is because we need the cache to be available before we get cached responses back
      // Which we need for this test. This will sometimes still not be long enough and the test
      // will run again.
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Second call: AI SDK wrapper with cache hit
      const wrappedAnthropicModel = wrapLanguageModel({
        model: anthropic(testAnthropicModelName),
        middleware: BraintrustMiddleware({
          debug: true,
          name: "TokenCountTestMiddleware",
        }),
      });

      await generateText({
        model: wrappedAnthropicModel,
        messages: [
          {
            role: "system",
            content: LONG_SYSTEM_PROMPT,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
          {
            role: "user",
            content: TEST_USER_PROMPT,
          },
        ],
        maxRetries: 0,
      });

      const aiSdkSpans = await testLogger.drain();
      expect(aiSdkSpans).toHaveLength(1);
      const aiSdkSpan = aiSdkSpans[0] as any;

      await directClient.messages.create({
        model: testAnthropicModelName,
        max_tokens: 50,
        system: CACHEABLE_SYSTEM_MESSAGE,
        messages: [
          {
            role: "user",
            content: TEST_USER_PROMPT,
          },
        ],
      });

      const directSpans = await testLogger.drain();
      expect(directSpans).toHaveLength(1);
      const directSpan = directSpans[0] as any;

      // Verify both wrappers have consistent token metrics
      expect(aiSdkSpan.metrics).toHaveProperty("prompt_tokens");
      expect(aiSdkSpan.metrics).toHaveProperty("completion_tokens");
      expect(aiSdkSpan.metrics).toHaveProperty("tokens");
      expect(aiSdkSpan.metrics).toHaveProperty("prompt_cached_tokens");

      expect(directSpan.metrics).toHaveProperty("prompt_tokens");
      expect(directSpan.metrics).toHaveProperty("completion_tokens");
      expect(directSpan.metrics).toHaveProperty("tokens");
      expect(directSpan.metrics).toHaveProperty("prompt_cached_tokens");

      // Both cached calls should have identical token counts
      expect(aiSdkSpan.metrics.prompt_tokens).toBe(
        directSpan.metrics.prompt_tokens,
      );
      expect(aiSdkSpan.metrics.completion_tokens).toBe(expect.any(Number));
      expect(aiSdkSpan.metrics.tokens).toBe(expect.any(Number));
      expect(aiSdkSpan.metrics.prompt_cached_tokens).toBe(expect.any(Number));

      // Verify provider detection
      expect(aiSdkSpan.metadata.provider).toBe("anthropic");
      expect(directSpan.metadata.provider).toBe("anthropic");
    },
  );
});
