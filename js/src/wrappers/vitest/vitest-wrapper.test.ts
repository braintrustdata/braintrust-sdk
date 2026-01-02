import { test, expect, describe, beforeAll, afterAll, vi } from "vitest";
import { wrapVitest } from "./index";
import { _exportsForTestingOnly } from "../../logger";

describe("Braintrust Vitest Wrapper", () => {
  beforeAll(async () => {
    _exportsForTestingOnly.setInitialTestState();
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  afterAll(async () => {
    await _exportsForTestingOnly.simulateLogoutForTests();
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
  });

  describe("wrapper behavior", () => {
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
