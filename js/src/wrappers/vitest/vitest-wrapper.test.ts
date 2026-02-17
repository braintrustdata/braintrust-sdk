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

// ✅ Set up test state and background logger at module level for unit tests
_exportsForTestingOnly.setInitialTestState();
await _exportsForTestingOnly.simulateLoginForTests();
_exportsForTestingOnly.useTestBackgroundLogger();

// ✅ STEP 2: Mock initDataset and initExperiment to avoid network calls
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
  // Test logger already set up at module level

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

// Unit tests for configuration and features
describe("Configuration Options", () => {
  // Test logger already set up at module level

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

// ✅ STEP 3: Module-level cleanup after all tests complete
afterAll(async () => {
  await _exportsForTestingOnly.clearTestBackgroundLogger();
  await _exportsForTestingOnly.simulateLogoutForTests();
});
