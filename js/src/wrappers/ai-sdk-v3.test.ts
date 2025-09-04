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
    const res = await generateText({
      model,
      prompt: "What is 2+2?",
      system: "Reply with just the number.",
    });
    const end = Date.now();

    const spans = await testLogger.drain();
    expect(spans).toHaveLength(1);
    const span = spans[0] as any;

    expect(span.span_attributes?.name).toBe("ai-sdk.generateText");
    expect(span.metadata?.provider).toBe(name);
    expect(typeof span.metadata?.model).toBe("string");
    expect(typeof span.metadata?.finish_reason).toBe("string");

    expect(typeof res.text).toBe("string");
    expect(res.text).toMatch(/4/);
    expect(span.output).toEqual([{ type: "text", text: res.text }]);
    assertTimingValid(start, end, span.metrics);
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

    const spans = await testLogger.drain();
    expect(spans).toHaveLength(1);
    const span = spans[0] as any;

    expect(span.span_attributes?.name).toBe("ai-sdk.streamText");
    expect(span.metadata?.provider).toBe(name);
    expect(typeof span.metadata?.model).toBe("string");
    expect(typeof span.metadata?.finish_reason).toBe("string");

    expect(typeof full).toBe("string");
    expect(full.length).toBeGreaterThan(10);
    expect(span.output).toEqual([{ type: "text", text: full }]);
    expect(typeof span.metrics?.time_to_first_token).toBe("number");
    assertTimingValid(start, end, span.metrics);
  });

  // Use a simple schema that tends to work across providers
  const simpleSchema = z.object({ answer: z.string() });

  test.each(PROVIDERS)("generateObject (%s)", async ({ name, model }) => {
    expect(await testLogger.drain()).toHaveLength(0);

    const start = Date.now();
    let result: any;
    try {
      result = await generateObject({
        model,
        schema: simpleSchema,
        prompt: "Return only a JSON object with key 'answer' set to 'ok'.",
      });
    } catch (e: any) {
      // Some providers/models may not support structured outputs; bail out gracefully
      if (
        String(e?.message || e)
          .toLowerCase()
          .includes("unsupported")
      ) {
        return;
      }
      throw e;
    }
    const end = Date.now();

    const spans = await testLogger.drain();
    expect(spans).toHaveLength(1);
    const span = spans[0] as any;

    expect(span.span_attributes?.name).toBe("ai-sdk.generateObject");
    expect(span.metadata?.provider).toBe(name);
    expect(typeof span.metadata?.model).toBe("string");
    expect(typeof span.metadata?.finish_reason).toBe("string");

    expect(result?.object && typeof result.object).toBe("object");
    expect(typeof (result.object as any).answer).toBe("string");
    expect(((result.object as any).answer as string).toLowerCase()).toContain(
      "ok",
    );
    expect(span.output).toEqual(result.object);
    assertTimingValid(start, end, span.metrics);
  });

  test.each(PROVIDERS)("streamObject (%s)", async ({ name, model }) => {
    expect(await testLogger.drain()).toHaveLength(0);

    const start = Date.now();
    let streamRes: any;
    try {
      streamRes = await streamObject({
        model,
        schema: simpleSchema,
        prompt: "Stream a JSON object with key 'answer' set to 'ok'.",
      });
    } catch (e: any) {
      if (
        String(e?.message || e)
          .toLowerCase()
          .includes("unsupported")
      ) {
        return;
      }
      throw e;
    }

    // Consume the partial object stream so onFinish fires
    const reader = streamRes.partialObjectStream.getReader();
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
    const end = Date.now();

    const spans = await testLogger.drain();
    expect(spans).toHaveLength(1);
    const span = spans[0] as any;

    expect(span.span_attributes?.name).toBe("ai-sdk.streamObject");
    expect(span.metadata?.provider).toBe(name);
    expect(typeof span.metadata?.model).toBe("string");
    expect(typeof span.metadata?.finish_reason).toBe("string");

    expect(span.output && typeof span.output).toBe("object");
    expect(typeof span.metrics?.time_to_first_token).toBe("number");
    assertTimingValid(start, end, span.metrics);
  });
});
