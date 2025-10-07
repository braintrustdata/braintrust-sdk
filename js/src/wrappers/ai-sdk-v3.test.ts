import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import * as ai from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

import { wrapAISDK } from "./ai-sdk-v3";
import {
  _exportsForTestingOnly,
  Logger,
  TestBackgroundLogger,
  initLogger,
} from "../logger";

const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-3-haiku-20240307";
const TEST_SUITE_OPTIONS = { timeout: 20000, retry: 2 } as const;

// Initialize test state for logger utilities
_exportsForTestingOnly.setInitialTestState();

// Wrap the AI SDK v3 surface
const { generateText, streamText, generateObject, streamObject } = wrapAISDK(
  ai as any,
);

type ProviderCase = { name: "openai" | "anthropic"; model: any };
const PROVIDERS: ProviderCase[] = [
  { name: "openai", model: openai(OPENAI_MODEL) },
  { name: "anthropic", model: anthropic(ANTHROPIC_MODEL) },
];

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

describe("ai-sdk v3 wrapper", TEST_SUITE_OPTIONS, () => {
  let testLogger: TestBackgroundLogger;
  let logger: Logger<true>;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    testLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    logger = initLogger({
      projectName: "ai-sdk-v3.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test.each(PROVIDERS)("generateText (%s)", async ({ name, model }) => {
    expect(await testLogger.drain()).toHaveLength(0);

    const start = Date.now();
    let res: any;
    res = await generateText({
      model,
      prompt: "What is 2+2?",
      system: "Reply with just the number.",
    });
    const end = Date.now();

    const spans = (await testLogger.drain()) as any[];
    expect(spans.length).toBeGreaterThanOrEqual(2);
    // Choose the wrapper span (logs output as a string), not the middleware span
    const wrapperSpan = spans.find(
      (s) =>
        s?.span_attributes?.name === "ai-sdk.generateText" &&
        typeof s?.output === "string",
    );
    expect(wrapperSpan).toBeTruthy();
    expect(wrapperSpan.metadata?.provider).toBe(name);
    expect(typeof wrapperSpan.metadata?.model).toBe("string");
    // Some providers may omit finish_reason for object streaming
    const fr = (wrapperSpan.metadata ?? {}).finish_reason;
    expect(fr === undefined || typeof fr === "string").toBe(true);

    expect(typeof res.text).toBe("string");
    expect(res.text).toMatch(/4/);
    expect(wrapperSpan.output).toBe(res.text);
    assertTimingValid(
      start,
      end,
      wrapperSpan.metrics ?? { start: start / 1000, end: end / 1000 },
    );

    // Expected JSON (subset) and parent-child relationship
    expect(wrapperSpan).toEqual(
      expect.objectContaining({
        span_attributes: expect.objectContaining({
          name: "ai-sdk.generateText",
        }),
        metadata: expect.objectContaining({
          provider: name,
          model: expect.any(String),
          finish_reason: expect.any(String),
        }),
        output: res.text,
      }),
    );
  });

  test.each(PROVIDERS)("streamText (%s)", async ({ name, model }) => {
    expect(await testLogger.drain()).toHaveLength(0);

    const start = Date.now();

    const { textStream } = await streamText({
      model,
      prompt: "Please recite the last line of Shakespeare's Sonnet 18",
      system: "Respond with only the line, no extra text.",
    });

    let full = "";
    for await (const chunk of textStream) full += chunk;
    const end = Date.now();

    const spans = (await testLogger.drain()) as any[];
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const wrapperSpan = spans.find(
      (s) =>
        s?.span_attributes?.name === "ai-sdk.streamText" &&
        typeof s?.output === "string",
    );
    expect(wrapperSpan).toBeTruthy();

    expect(wrapperSpan.metadata?.provider).toBe(name);
    expect(typeof wrapperSpan.metadata?.model).toBe("string");
    const fr2 = (wrapperSpan.metadata ?? {}).finish_reason;
    expect(fr2 === undefined || typeof fr2 === "string").toBe(true);

    expect(typeof full).toBe("string");
    expect(full.length).toBeGreaterThan(10);
    expect(wrapperSpan.output).toBe(full);
    expect(typeof wrapperSpan.metrics?.time_to_first_token).toBe("number");
    assertTimingValid(
      start,
      end,
      wrapperSpan.metrics ?? { start: start / 1000, end: end / 1000 },
    );

    expect(wrapperSpan).toEqual(
      expect.objectContaining({
        span_attributes: expect.objectContaining({ name: "ai-sdk.streamText" }),
        metadata: expect.objectContaining({
          provider: name,
          model: expect.any(String),
          finish_reason: expect.any(String),
        }),
        output: full,
      }),
    );
  });

  // Use a simple schema that tends to work across providers
  const simpleSchema = z.object({ answer: z.string() });

  test.each(PROVIDERS)("generateObject (%s)", async ({ name, model }) => {
    expect(await testLogger.drain()).toHaveLength(0);

    const start = Date.now();
    let result: any;

    result = await generateObject({
      model,
      schema: simpleSchema,
      prompt: "Return only a JSON object with key 'answer' set to 'ok'.",
    });

    const end = Date.now();

    const spans = (await testLogger.drain()) as any[];
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const wrapperSpan = spans.find(
      (s) =>
        s?.span_attributes?.name === "ai-sdk.generateObject" &&
        s?.output &&
        typeof s.output === "object",
    );
    expect(wrapperSpan).toBeTruthy();

    expect(wrapperSpan.metadata?.provider).toBe(name);
    expect(typeof wrapperSpan.metadata?.model).toBe("string");
    const fr3 = (wrapperSpan.metadata ?? {}).finish_reason;
    expect(fr3 === undefined || typeof fr3 === "string").toBe(true);

    expect(result?.object && typeof result.object).toBe("object");
    expect(typeof (result.object as any).answer).toBe("string");
    expect(((result.object as any).answer as string).toLowerCase()).toContain(
      "ok",
    );
    expect(wrapperSpan.output).toEqual(result.object);
    assertTimingValid(
      start,
      end,
      wrapperSpan.metrics ?? { start: start / 1000, end: end / 1000 },
    );

    expect(wrapperSpan).toEqual(
      expect.objectContaining({
        span_attributes: expect.objectContaining({
          name: "ai-sdk.generateObject",
        }),
        metadata: expect.objectContaining({
          provider: name,
          model: expect.any(String),
          finish_reason: expect.any(String),
        }),
        output: result.object,
      }),
    );
  });

  test.each(PROVIDERS)("streamObject (%s)", async ({ name, model }) => {
    expect(await testLogger.drain()).toHaveLength(0);

    const start = Date.now();
    let streamRes: any;
    streamRes = await streamObject({
      model,
      schema: simpleSchema,
      prompt: "Stream a JSON object with key 'answer' set to 'ok'.",
    });
    // Consume the partial object stream (AsyncIterable) so onFinish fires
    for await (const _chunk of streamRes.partialObjectStream) {
      // no-op: just draining
    }
    const end = Date.now();

    const spans = (await testLogger.drain()) as any[];
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const wrapperSpan = spans.find(
      (s) =>
        s?.span_attributes?.name === "ai-sdk.streamObject" &&
        s?.output &&
        typeof s.output === "object",
    );
    expect(wrapperSpan).toBeTruthy();

    expect(wrapperSpan.metadata?.provider).toBe(name);
    expect(typeof wrapperSpan.metadata?.model).toBe("string");
    const finishReason = (wrapperSpan.metadata ?? {}).finish_reason;
    expect(finishReason === undefined || typeof finishReason === "string").toBe(
      true,
    );

    expect(wrapperSpan.output && typeof wrapperSpan.output).toBe("object");
    expect(typeof wrapperSpan.metrics?.time_to_first_token).toBe("number");
    assertTimingValid(
      start,
      end,
      wrapperSpan.metrics ?? { start: start / 1000, end: end / 1000 },
    );

    expect(typeof streamRes.toTextStreamResponse).toBe("function");
    const textStreamResponse = streamRes.toTextStreamResponse();
    expect(textStreamResponse).toBeDefined();

    expect(wrapperSpan).toEqual(
      expect.objectContaining({
        span_attributes: expect.objectContaining({
          name: "ai-sdk.streamObject",
        }),
        metadata: expect.objectContaining({
          provider: name,
          model: expect.any(String),
        }),
        output: expect.any(Object),
      }),
    );
  });
});
