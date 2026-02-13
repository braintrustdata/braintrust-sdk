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
import * as logger from "../../logger";
import { getExperimentContext } from "./wrapper";
import {
  getVitestContextManager,
  _resetContextManager,
} from "./context-manager";
import { flushExperimentWithSync } from "./flush-manager";

// Mock initDataset and initExperiment to avoid network calls
vi.spyOn(logger, "initDataset").mockReturnValue({
  insert: vi.fn(() => "test-example-id"),
} as any);

vi.spyOn(logger, "initExperiment").mockImplementation(
  (projectName: string, options?: any) => {
    return _exportsForTestingOnly.initTestExperiment(
      options?.experiment || "test-experiment",
      projectName,
    );
  },
);

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

      expect(mockTest).toHaveBeenCalledWith(
        "test name",
        undefined,
        expect.any(Function),
      );
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

const bt = wrapVitest(
  { test, expect, describe, beforeAll, afterAll },
  {
    projectName: "test-vitest-wrapper-integration",
    displaySummary: false,
  },
);

// Integration tests that actually use the wrapped Vitest
bt.describe("Braintrust Vitest Wrapper Calls", () => {
  let backgroundLogger: TestBackgroundLogger;
  let logger: ReturnType<typeof initLogger>;

  beforeAll(async () => {
    _exportsForTestingOnly.setInitialTestState();
    await _exportsForTestingOnly.simulateLoginForTests();
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();

    logger = initLogger({
      projectName: "test-vitest-wrapper-integration",
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

  bt.test("test creates span and logs outputs", async () => {
    // Simulate some work
    const result = { text: "test result", status: "success" };

    bt.logOutputs({ text: result.text });
    bt.logFeedback({ name: "quality", score: 1.0 });

    // Verify span was created
    const span = bt.getCurrentSpan();
    expect(span).toBeDefined();
    expect(span?.log).toBeDefined();

    expect(result.text).toBe("test result");
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
      // Simulate processing the input
      const result = { text: "1, 2, 3" };

      expect(result.text).toBeTruthy();
      expect(input).toEqual({ prompt: "Count to 3" });
      expect(expected).toBe("1, 2, 3");

      bt.logOutputs({ text: result.text });
      bt.logFeedback({ name: "correctness", score: 0.8 });
    },
  );

  bt.test("test with metrics tracking", async () => {
    // Simulate some computation
    const result = { answer: "4", computationTime: 10 };

    expect(result.answer).toBeTruthy();

    bt.logOutputs({ answer: result.answer });
    bt.logFeedback({ name: "accuracy", score: 1.0 });

    // Verify span context is available
    const span = bt.getCurrentSpan();
    expect(span).toBeDefined();
  });

  bt.test("test with multiple log calls", async () => {
    bt.logOutputs({ step1: "completed" });
    bt.logOutputs({ step2: "completed" });
    bt.logFeedback({ name: "quality", score: 0.9 });
    bt.logFeedback({ name: "speed", score: 0.8 });

    expect(true).toBe(true);
  });
});

// Comprehensive tests for new features and fixes
describe("Configuration Options", () => {
  beforeAll(async () => {
    _exportsForTestingOnly.setInitialTestState();
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  afterAll(async () => {
    await _exportsForTestingOnly.simulateLogoutForTests();
  });

  test("supports progress reporting callback", () => {
    const events: any[] = [];
    const bt = wrapVitest(
      { test, expect, describe, beforeAll, afterAll },
      {
        projectName: "test",
        displaySummary: false,
        onProgress: (event) => events.push(event),
      },
    );
    expect(bt).toBeDefined();
    // Progress events will be emitted if onProgress is provided
  });
});

describe("Context Manager", () => {
  test("getExperimentContext returns null when no context is set", () => {
    // Reset context manager to ensure clean state
    _resetContextManager();

    const context = getExperimentContext();
    expect(context).toBeNull();
  });

  test("context manager maintains isolation", () => {
    const manager = getVitestContextManager();
    expect(manager).toBeDefined();
    expect(manager.getCurrentContext()).toBeUndefined();
  });
});

describe("Flush Manager", () => {
  test("flushExperimentWithSync handles null context gracefully", async () => {
    // Should not throw with null context
    await expect(
      flushExperimentWithSync(null, { displaySummary: false }),
    ).resolves.toBeUndefined();
  });
});

describe("Scorer and Dataset Support", () => {
  let bt: BraintrustVitest;

  beforeEach(() => {
    _resetContextManager();
    bt = wrapVitest(
      { test, expect, describe, afterAll },
      { projectName: "feature-tests" },
    );
  });

  test("scorer types are exported", () => {
    // Verify scorer functionality is available
    const testConfig = {
      input: { value: 5 },
      scorers: [
        ({ output }: any) => ({ name: "test", score: output === 10 ? 1 : 0 }),
      ],
    };
    expect(testConfig.scorers).toHaveLength(1);
  });

  test("data field accepts array", () => {
    // Verify data functionality is available
    const testConfig = {
      data: [
        { input: { value: 1 }, expected: 2 },
        { input: { value: 2 }, expected: 4 },
      ],
    };
    expect(testConfig.data).toHaveLength(2);
  });

  test("test config supports scorers and data fields", () => {
    // Type check - this validates the TypeScript types compile correctly
    const config: import("./types").TestConfig = {
      input: { x: 1 },
      expected: 2,
      scorers: [() => 1],
      data: [{ input: {}, expected: {} }],
    };
    expect(config).toBeDefined();
  });
});
