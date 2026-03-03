import { test, describe, afterAll, expect, beforeAll } from "bun:test";
import { initBunTestSuite } from "./suite";
import {
  setupBunTestEnv,
  teardownBunTestEnv,
  createTestInitExperiment,
} from "./test-helpers";

beforeAll(async () => {
  await setupBunTestEnv();
});

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

describe("initBunTestSuite API surface", () => {
  const suite = initBunTestSuite({
    projectName: "api-surface",
    test,
    _initExperiment: createTestInitExperiment(),
  });

  test("suite has test, it, and flush", () => {
    expect(suite.test).toBeDefined();
    expect(typeof suite.test).toBe("function");
    expect(suite.it).toBeDefined();
    expect(suite.it).toBe(suite.test);
    expect(suite.flush).toBeDefined();
    expect(typeof suite.flush).toBe("function");
  });

  test("suite.test has all modifier properties", () => {
    expect(typeof suite.test.skip).toBe("function");
    expect(typeof suite.test.only).toBe("function");
    expect(typeof suite.test.todo).toBe("function");
    expect(typeof suite.test.failing).toBe("function");
    expect(typeof suite.test.concurrent).toBe("function");
    expect(typeof suite.test.serial).toBe("function");
    expect(typeof suite.test.if).toBe("function");
    expect(typeof suite.test.skipIf).toBe("function");
    expect(typeof suite.test.todoIf).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Basic traced eval
// ---------------------------------------------------------------------------

describe("basic traced eval", () => {
  let result: unknown;

  const suite = initBunTestSuite({
    projectName: "basic-eval",
    test,
    displaySummary: false,
    _initExperiment: createTestInitExperiment(),
  });

  suite.test(
    "runs traced eval and returns output",
    { input: "hello" },
    async ({ input }) => {
      result = `processed: ${input}`;
      return result;
    },
  );

  test("traced eval produced correct result", () => {
    expect(result).toBe("processed: hello");
  });
});

// ---------------------------------------------------------------------------
// Scorer invocation
// ---------------------------------------------------------------------------

describe("scorer invocation", () => {
  let scorerCallArgs: any = null;

  const suite = initBunTestSuite({
    projectName: "scorer-test",
    test,
    displaySummary: false,
    _initExperiment: createTestInitExperiment(),
  });

  suite.test(
    "test with scorer",
    {
      input: { text: "hello" },
      expected: "world",
      metadata: { lang: "en" },
      scorers: [
        (args) => {
          scorerCallArgs = args;
          return { name: "test_score", score: 1 };
        },
      ],
    },
    async () => "output-value",
  );

  test("scorer received correct arguments", () => {
    expect(scorerCallArgs).toEqual({
      output: "output-value",
      expected: "world",
      input: { text: "hello" },
      metadata: { lang: "en" },
    });
  });
});

// ---------------------------------------------------------------------------
// Scorers run on error
// ---------------------------------------------------------------------------

describe("scorers run even when test function throws", () => {
  let scorerCalled = false;

  const suite = initBunTestSuite({
    projectName: "scorer-error-test",
    test,
    displaySummary: false,
    _initExperiment: createTestInitExperiment(),
  });

  // test.failing expects the test to throw — bun marks it as passed
  suite.test.failing(
    "error test",
    {
      input: "hello",
      scorers: [
        () => {
          scorerCalled = true;
          return { name: "post_error_score", score: 0 };
        },
      ],
    },
    async () => {
      throw new Error("test failure");
    },
  );

  test("scorer was still called", () => {
    expect(scorerCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Return value logged as output
// ---------------------------------------------------------------------------

describe("return value", () => {
  let captured: unknown;

  const suite = initBunTestSuite({
    projectName: "output-test",
    test,
    displaySummary: false,
    _initExperiment: createTestInitExperiment(),
  });

  suite.test("output test", { input: "hello" }, async () => {
    captured = { result: "some output" };
    return captured;
  });

  test("return value was captured", () => {
    expect(captured).toEqual({ result: "some output" });
  });
});

// ---------------------------------------------------------------------------
// afterAll registration
// ---------------------------------------------------------------------------

describe("afterAll registration", () => {
  test("afterAll is called with a flush function", () => {
    const fns: Function[] = [];
    initBunTestSuite({
      projectName: "after-test",
      test,
      afterAll: (fn) => fns.push(fn),
      _initExperiment: createTestInitExperiment(),
    });

    expect(fns).toHaveLength(1);
    expect(typeof fns[0]).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Flush behavior
// ---------------------------------------------------------------------------

describe("flush", () => {
  test("flush is a no-op when no experiment was created", async () => {
    const suite = initBunTestSuite({
      projectName: "no-experiment",
      test,
      displaySummary: false,
      _initExperiment: createTestInitExperiment(),
    });

    // Should not throw even though no eval was called
    await suite.flush();
  });
});

// ---------------------------------------------------------------------------
// Span naming
// ---------------------------------------------------------------------------

describe("span naming via progress events", () => {
  const events: any[] = [];

  const suite = initBunTestSuite({
    projectName: "name-test",
    test,
    displaySummary: false,
    onProgress: (event) => events.push(event),
    _initExperiment: createTestInitExperiment(),
  });

  suite.test(
    "original-name",
    { input: "hello", name: "custom-span-name" },
    async () => "result",
  );

  suite.test("test-name-used", { input: "hello" }, async () => "result");

  test("evalConfig.name overrides test name for span", () => {
    const starts = events.filter((e) => e.type === "test_start");
    expect(starts[0].testName).toBe("custom-span-name");
  });

  test("test name is used when evalConfig.name is not set", () => {
    const starts = events.filter((e) => e.type === "test_start");
    expect(starts[1].testName).toBe("test-name-used");
  });
});

// ---------------------------------------------------------------------------
// Progress events
// ---------------------------------------------------------------------------

describe("onProgress events", () => {
  const events: any[] = [];

  const suite = initBunTestSuite({
    projectName: "progress-test",
    test,
    displaySummary: false,
    onProgress: (event) => events.push(event),
    _initExperiment: createTestInitExperiment(),
  });

  suite.test("progress-test", { input: "hello" }, async () => "result");

  test("receives test_start and test_complete events", () => {
    expect(events).toEqual([
      { type: "test_start", testName: "progress-test" },
      expect.objectContaining({
        type: "test_complete",
        testName: "progress-test",
        passed: true,
      }),
    ]);
    expect(typeof events[1].duration).toBe("number");
  });
});

describe("onProgress on failure", () => {
  const events: any[] = [];

  const suite = initBunTestSuite({
    projectName: "fail-progress-test",
    test,
    displaySummary: false,
    onProgress: (event) => events.push(event),
    _initExperiment: createTestInitExperiment(),
  });

  // Use test.failing so bun expects the throw
  suite.test.failing("fail-test", { input: "hello" }, async () => {
    throw new Error("intentional failure");
  });

  test("reports passed=false when test throws", () => {
    const complete = events.find((e) => e.type === "test_complete");
    expect(complete.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Modifiers — verify they register without error
// ---------------------------------------------------------------------------

describe("test modifiers", () => {
  const suite = initBunTestSuite({
    projectName: "modifier-test",
    test,
    displaySummary: false,
    _initExperiment: createTestInitExperiment(),
  });

  suite.test.skip("skipped test", { input: "x" }, async () => "y");
  suite.test.todo("todo test");
  suite.test.skipIf(true)("skipIf-true test", { input: "x" }, async () => "y");
  suite.test.todoIf(true)("todoIf-true test", { input: "x" }, async () => "y");

  // If(false) should not run the test
  suite.test.if(false)("if-false test", { input: "x" }, async () => {
    throw new Error("should not run");
  });

  // If(true) should run the test
  suite.test.if(true)("if-true test", { input: "x" }, async () => "y");
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  teardownBunTestEnv();
});
