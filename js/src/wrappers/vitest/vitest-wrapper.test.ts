import {
  test,
  expect,
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
  expectTypeOf,
} from "vitest";
import { wrapVitest } from "./index";
import {
  _exportsForTestingOnly,
  initLogger,
  type TestBackgroundLogger,
} from "../../logger";
import type { BraintrustVitest } from "./types";
import { getCurrentUnixTimestamp } from "../../util";

// Try to import AI SDK for integration tests
let ai: typeof import("ai") | undefined;
let openai: typeof import("@ai-sdk/openai").openai | undefined;
let wrapAISDK: typeof import("../ai-sdk/ai-sdk").wrapAISDK | undefined;

try {
  const aiModule = await import("ai");
  const openaiModule = await import("@ai-sdk/openai");
  const aiSdkModule = await import("../ai-sdk/ai-sdk");
  ai = aiModule;
  openai = openaiModule.openai;
  wrapAISDK = aiSdkModule.wrapAISDK;
} catch (e) {
  console.warn("AI SDK not available, skipping integration tests");
}

const TEST_MODEL = "gpt-4o-mini";
const TEST_SUITE_OPTIONS = { timeout: 30000, retry: 3 };

describe("Braintrust Vitest Wrapper", () => {
  beforeAll(async () => {
    _exportsForTestingOnly.setInitialTestState();
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  afterAll(async () => {
    await _exportsForTestingOnly.simulateLogoutForTests();
  });

  test("vitest is installed", () => {
    expect(test).toBeDefined();
    expect(expect).toBeDefined();
    expect(describe).toBeDefined();
  });

  describe("validation", () => {
    test("wrapVitest requires test, describe, and expect", () => {
      expect(() => {
        wrapVitest({} as any);
      }).toThrow("test is required");

      expect(() => {
        wrapVitest({ test } as any);
      }).toThrow("describe is required");

      expect(() => {
        wrapVitest({ test, describe } as any);
      }).toThrow("expect is required");
    });

    test("returns wrapped vitest methods", () => {
      const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });

      expect(bt.test).toBeDefined();
      expect(bt.it).toBeDefined();
      expect(bt.describe).toBeDefined();
      expect(bt.expect).toBe(expect);
      expect(bt.beforeAll).toBeDefined();
      expect(bt.afterAll).toBeDefined();
      expect(bt.logOutputs).toBeDefined();
      expect(bt.logFeedback).toBeDefined();
      expect(bt.getCurrentSpan).toBeDefined();
    });

    test("wrapping preserves types", () => {
      const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });

      // Verify return type is correct
      expectTypeOf(bt).toMatchTypeOf<BraintrustVitest>();

      // Verify methods have correct types
      expectTypeOf(bt.test).toBeFunction();
      expectTypeOf(bt.it).toBeFunction();
      expectTypeOf(bt.describe).toBeFunction();
      expectTypeOf(bt.logOutputs).toBeFunction();
      expectTypeOf(bt.logFeedback).toBeFunction();
      expectTypeOf(bt.getCurrentSpan).toBeFunction();
    });
  });

  describe("wrapper behavior", () => {
    test("handles optional beforeAll/afterAll/beforeEach/afterEach", () => {
      // Should not throw when optional methods are missing
      const bt = wrapVitest({
        test,
        expect,
        describe,
      });

      expect(bt.beforeAll).toBeDefined();
      expect(bt.afterAll).toBeDefined();
      expect(bt.beforeEach).toBeUndefined();
      expect(bt.afterEach).toBeUndefined();

      // Should work when provided
      const btWithHooks = wrapVitest({
        test,
        expect,
        describe,
        beforeAll,
        afterAll,
      });

      expect(btWithHooks.beforeAll).toBe(beforeAll);
      expect(btWithHooks.afterAll).toBe(afterAll);
    });

    test("wrapping test function calls original test", () => {
      const mockTest = vi.fn();
      const bt = wrapVitest({
        test: mockTest as any,
        expect,
        describe,
        beforeAll,
        afterAll,
      });

      bt.test("test name", () => {});

      expect(mockTest).toHaveBeenCalledWith("test name", expect.any(Function));
    });

    test("wrapping describe function calls original describe", () => {
      const mockDescribe = vi.fn();
      const bt = wrapVitest({
        test,
        expect,
        describe: mockDescribe as any,
        beforeAll,
        afterAll,
      });

      bt.describe("suite name", () => {});

      expect(mockDescribe).toHaveBeenCalledWith(
        "suite name",
        expect.any(Function),
      );
    });

    test("it is an alias for test", () => {
      const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });

      expect(bt.it).toBe(bt.test);
    });
  });

  describe("API surface", () => {
    test("getCurrentSpan returns NOOP_SPAN when called outside test", () => {
      const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });
      const span = bt.getCurrentSpan();

      expect(span).toBeDefined();
      expect(span).not.toBeNull();
      if (span) {
        expect(span.log).toBeDefined();
      }
    });
  });

  describe("vitest modifiers", () => {
    test("wrapped test supports skip modifier", () => {
      const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });

      expect(bt.test.skip).toBeDefined();
      expect(typeof bt.test.skip).toBe("function");
    });

    test("wrapped test supports only modifier", () => {
      const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });

      expect(bt.test.only).toBeDefined();
      expect(typeof bt.test.only).toBe("function");
    });

    test("wrapped test supports concurrent modifier", () => {
      const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });

      expect(bt.test.concurrent).toBeDefined();
      expect(typeof bt.test.concurrent).toBe("function");
    });

    test("wrapped test supports todo modifier", () => {
      const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });

      expect(bt.test.todo).toBeDefined();
    });

    test("wrapped test supports each modifier", () => {
      const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });

      expect(bt.test.each).toBeDefined();
    });
  });
});

// Integration tests that actually use the wrapped Vitest
describe.skipIf(!ai || !openai || !wrapAISDK)(
  "Braintrust Vitest Wrapper Integration Tests",
  TEST_SUITE_OPTIONS,
  () => {
    let backgroundLogger: TestBackgroundLogger;
    let logger: ReturnType<typeof initLogger>;

    beforeAll(async () => {
      _exportsForTestingOnly.setInitialTestState();
      await _exportsForTestingOnly.simulateLoginForTests();
      backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();

      logger = initLogger({
        projectName: "test-vitest-wrapper-integration",
        projectId: "test-project-id",
      });
    });

    afterAll(async () => {
      await logger.flush();

      // Verify spans were captured during tests
      const spans = await backgroundLogger.drain();
      expect(spans.length).toBeGreaterThan(0);

      // Find test spans
      const testSpans = spans.filter(
        (s: any) => s.span_attributes?.type === "task",
      );
      expect(testSpans.length).toBeGreaterThan(0);

      // Verify automatic pass/fail logging
      const passingTests = testSpans.filter((s: any) => s.scores?.pass === 1);
      expect(passingTests.length).toBeGreaterThan(0);

      await _exportsForTestingOnly.clearTestBackgroundLogger();
      await _exportsForTestingOnly.simulateLogoutForTests();
    });

    // Use the actual wrapped Vitest for these tests
    const bt = wrapVitest({ test, expect, describe, beforeAll, afterAll });

    bt.test("test with OpenAI call creates span", async () => {
      if (!ai || !openai || !wrapAISDK) return;

      const wrappedAI = wrapAISDK(ai);
      const start = getCurrentUnixTimestamp();

      const result = await wrappedAI.generateText({
        model: openai!(TEST_MODEL),
        messages: [
          {
            role: "user",
            content: "Say 'test' in one word",
          },
        ],
        maxOutputTokens: 20,
      });

      const end = getCurrentUnixTimestamp();

      expect(result.text).toBeTruthy();
      expect(result.text.toLowerCase()).toContain("test");

      bt.logOutputs({ text: result.text });
      bt.logFeedback({ name: "quality", score: 1.0 });

      // Verify span was created
      const span = bt.getCurrentSpan();
      expect(span).toBeDefined();
      expect(span?.log).toBeDefined();
    });

    bt.test(
      "test with input and expected",
      {
        input: { prompt: "Count to 3" },
        expected: "1, 2, 3",
        metadata: { category: "counting" },
        tags: ["numbers"],
      },
      async ({ input, expected }) => {
        if (!ai || !openai || !wrapAISDK) return;

        const wrappedAI = wrapAISDK(ai);

        const result = await wrappedAI.generateText({
          model: openai!(TEST_MODEL),
          messages: [
            {
              role: "user",
              content: (input as any).prompt,
            },
          ],
          maxOutputTokens: 20,
        });

        expect(result.text).toBeTruthy();

        bt.logOutputs({ text: result.text });
        bt.logFeedback({ name: "correctness", score: 0.8 });
      },
    );

    bt.test("test with metrics tracking", async () => {
      if (!ai || !openai || !wrapAISDK) return;

      const wrappedAI = wrapAISDK(ai);
      const start = getCurrentUnixTimestamp();

      const result = await wrappedAI.generateText({
        model: openai!(TEST_MODEL),
        messages: [
          {
            role: "user",
            content: "What is 2+2? Answer in one word.",
          },
        ],
        maxOutputTokens: 20,
      });

      const end = getCurrentUnixTimestamp();

      expect(result.text).toBeTruthy();

      bt.logOutputs({ answer: result.text });
      bt.logFeedback({ name: "accuracy", score: 1.0 });

      // Verify span context is available
      const span = bt.getCurrentSpan();
      expect(span).toBeDefined();
    });

    bt.test("test with multiple log calls", async () => {
      if (!ai || !openai || !wrapAISDK) return;

      bt.logOutputs({ step1: "completed" });
      bt.logOutputs({ step2: "completed" });
      bt.logFeedback({ name: "quality", score: 0.9 });
      bt.logFeedback({ name: "speed", score: 0.8 });

      expect(true).toBe(true);
    });
  },
);
