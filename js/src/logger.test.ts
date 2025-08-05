/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  _exportsForTestingOnly,
  init,
  initLogger,
  Prompt,
  BraintrustState,
  wrapTraced,
  currentSpan,
} from "./logger";
import { LazyValue } from "./util";
import { configureNode } from "./node";

configureNode();

test("verify MemoryBackgroundLogger intercepts logs", async () => {
  // Log to memory for the tests.
  _exportsForTestingOnly.simulateLoginForTests();

  const memoryLogger = _exportsForTestingOnly.useTestBackgroundLogger();

  const logger = initLogger({
    projectName: "test",
    projectId: "test-project-id",
  });

  await memoryLogger.flush();
  expect(await memoryLogger.drain()).length(0);

  // make some spans
  const span = logger.startSpan({ name: "test-name-a" });
  span.log({ metrics: { v: 1 } });
  span.end();

  const span2 = logger.startSpan({ name: "test-name-b" });
  span2.log({ metrics: { v: 2 } });
  span2.end();

  await memoryLogger.flush();

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  const events = (await memoryLogger.drain()) as any[]; // FIXME[matt] what type should this be?
  expect(events).toHaveLength(2);

  events.sort((a, b) => a["metrics"]["v"] - b["metrics"]["v"]);

  // just check a couple of things, we're mostly looking to make sure the
  expect(events[0]["span_attributes"]["name"]).toEqual("test-name-a");
  expect(events[1]["span_attributes"]["name"]).toEqual("test-name-b");

  // and now it's empty
  expect(await memoryLogger.drain()).length(0);

  _exportsForTestingOnly.clearTestBackgroundLogger(); // can go back to normal
});

test("init validation", () => {
  expect(() => init({})).toThrow(
    "Must specify at least one of project or projectId",
  );
  expect(() => init({ project: "project", open: true, update: true })).toThrow(
    "Cannot open and update an experiment at the same time",
  );
  expect(() => init({ project: "project", open: true })).toThrow(
    "Cannot open an experiment without specifying its name",
  );
});

test("prompt.build with structured output templating", () => {
  const prompt = new Prompt<false, false>(
    {
      name: "Calculator",
      slug: "calculator",
      project_id: "p",
      prompt_data: {
        prompt: {
          type: "chat",
          messages: [
            {
              role: "system",
              content:
                "Please compute {{input.expression}} and return the result in JSON.",
            },
          ],
        },
        options: {
          model: "gpt-4o",
          params: {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "schema",
                schema: "{{input.schema}}",
                strict: true,
              },
            },
          },
        },
      },
    },
    {},
    false,
  );

  const result = prompt.build({
    input: {
      expression: "2 + 3",
      schema: {
        type: "object",
        properties: {
          final_answer: {
            type: "string",
          },
        },
        required: ["final_answer"],
        additionalProperties: false,
      },
    },
  });
  expect(result).toMatchObject({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "Please compute 2 + 3 and return the result in JSON.",
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "schema",
        schema: {
          type: "object",
          properties: {
            final_answer: { type: "string" },
          },
        },
      },
    },
  });
});

test("simulateLoginForTests and simulateLogoutForTests", async () => {
  for (let i = 0; i < 6; i++) {
    // First login
    const state = await _exportsForTestingOnly.simulateLoginForTests();
    // Verify the login state - now we're logged in
    expect(state.loggedIn).toBe(true);
    expect(state.loginToken).toBe("___TEST_API_KEY__THIS_IS_NOT_REAL___");
    expect(state.orgId).toBe("test-org-id");
    expect(state.orgName).toBe("test-org-name");
    expect(state.apiUrl).toBe("https://braintrust.dev/fake-api-url");

    // Now logout
    const logoutState = _exportsForTestingOnly.simulateLogoutForTests();

    // Verify the logout state - everything should be null or false
    expect(logoutState.loggedIn).toBe(false);
    expect(logoutState.loginToken).toBe(null);
    expect(logoutState.orgId).toBe(null);
    expect(logoutState.orgName).toBe(null);
    expect(logoutState.apiUrl).toBe(null);
    expect(logoutState.appUrl).toBe("https://www.braintrust.dev");
  }
});

test("span.export handles unauthenticated state", async () => {
  // Create a span without logging in
  const logger = initLogger({});
  const span = logger.startSpan({ name: "test-span" });
  span.end();

  // Export should still work and return a valid string
  let exported: string | undefined = undefined;
  let error;
  try {
    exported = await span.export();
  } catch (e) {
    error = e;
  }
  expect(error).toBeUndefined();
  expect(exported).toBeDefined();
  expect(typeof exported).toBe("string");
  expect((exported as string).length).toBeGreaterThan(0);
});

test("span.export handles unresolved parent object ID", async () => {
  // Create a span with a parent object ID that hasn't been resolved
  const logger = initLogger({});
  const span = logger.startSpan({
    name: "test-span",
    event: {
      metadata: {
        project_id: "test-project-id",
      },
    },
  });
  span.end();

  // Export should still work and return a valid string
  let exported: string | undefined = undefined;
  let error;
  try {
    exported = await span.export();
  } catch (e) {
    error = e;
  }
  expect(error).toBeUndefined();
  expect(exported).toBeDefined();
  expect(typeof exported).toBe("string");
  expect((exported as string).length).toBeGreaterThan(0);
});

test("startSpan support ids with parent", () => {
  const logger = initLogger({});
  const span = logger.startSpan({
    name: "test-span",
    spanId: "123",
    parentSpanIds: { spanId: "456", rootSpanId: "789" },
  });
  expect(span.spanId).toBe("123");
  expect(span.rootSpanId).toBe("789");
  expect(span.spanParents).toEqual(["456"]);
  span.end();
});

test("startSpan support ids without parent", () => {
  const logger = initLogger({});
  const span = logger.startSpan({ name: "test-span", spanId: "123" });
  expect(span.spanId).toBe("123");
  expect(span.rootSpanId).toBe("123");
  expect(span.spanParents).toEqual([]);
  span.end();
});

test("startSpan support ids with nested parent chain", () => {
  const logger = initLogger({});
  const span = logger.startSpan({
    name: "test-span",
    spanId: "123",
    parentSpanIds: {
      spanId: "456",
      rootSpanId: "789",
      parentSpanIds: ["111", "222", "456"],
    },
  });
  expect(span.spanId).toBe("123");
  expect(span.rootSpanId).toBe("789");
  expect(span.spanParents).toEqual(["111", "222", "456"]);
  span.end();
});

describe("isGeneratorFunction and isAsyncGeneratorFunction utilities", () => {
  const { isGeneratorFunction, isAsyncGeneratorFunction } =
    _exportsForTestingOnly;

  test("isGeneratorFunction correctly identifies sync generators", () => {
    // Positive cases
    expect(isGeneratorFunction(function* () {})).toBe(true);
    expect(
      isGeneratorFunction(function* gen() {
        yield 1;
      }),
    ).toBe(true);

    // Negative cases
    expect(isGeneratorFunction(function () {})).toBe(false);
    expect(isGeneratorFunction(() => {})).toBe(false);
    expect(isGeneratorFunction(async function () {})).toBe(false);
    expect(isGeneratorFunction(async function* () {})).toBe(false);

    // Edge cases
    expect(isGeneratorFunction(null)).toBe(false);
    expect(isGeneratorFunction(undefined)).toBe(false);
    expect(isGeneratorFunction(123)).toBe(false);
    expect(isGeneratorFunction("function*() {}")).toBe(false);
    expect(isGeneratorFunction({})).toBe(false);
    expect(isGeneratorFunction([])).toBe(false);
  });

  test("isAsyncGeneratorFunction correctly identifies async generators", () => {
    // Positive cases
    expect(isAsyncGeneratorFunction(async function* () {})).toBe(true);
    expect(
      isAsyncGeneratorFunction(async function* gen() {
        yield 1;
      }),
    ).toBe(true);

    // Negative cases
    expect(isAsyncGeneratorFunction(function () {})).toBe(false);
    expect(isAsyncGeneratorFunction(() => {})).toBe(false);
    expect(isAsyncGeneratorFunction(async function () {})).toBe(false);
    expect(isAsyncGeneratorFunction(function* () {})).toBe(false);

    // Edge cases
    expect(isAsyncGeneratorFunction(null)).toBe(false);
    expect(isAsyncGeneratorFunction(undefined)).toBe(false);
    expect(isAsyncGeneratorFunction(123)).toBe(false);
    expect(isAsyncGeneratorFunction("async function*() {}")).toBe(false);
    expect(isAsyncGeneratorFunction({})).toBe(false);
    expect(isAsyncGeneratorFunction([])).toBe(false);
  });

  test("generator detection works with various declaration styles", () => {
    // Named generators
    function* namedGen() {
      yield 1;
    }
    expect(isGeneratorFunction(namedGen)).toBe(true);

    // Anonymous generators
    const anonGen = function* () {
      yield 2;
    };
    expect(isGeneratorFunction(anonGen)).toBe(true);

    // Async named generators
    async function* namedAsyncGen() {
      yield 1;
    }
    expect(isAsyncGeneratorFunction(namedAsyncGen)).toBe(true);

    // Anonymous async generators
    const anonAsyncGen = async function* () {
      yield 2;
    };
    expect(isAsyncGeneratorFunction(anonAsyncGen)).toBe(true);
  });
});

describe("wrapTraced generator support", () => {
  let memoryLogger: any;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
    memoryLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    originalEnv = process.env.BRAINTRUST_MAX_GENERATOR_ITEMS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BRAINTRUST_MAX_GENERATOR_ITEMS = originalEnv;
    } else {
      delete process.env.BRAINTRUST_MAX_GENERATOR_ITEMS;
    }
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("traced sync generator", async () => {
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const tracedSyncGen = wrapTraced(function* syncNumberGenerator(n: number) {
      for (let i = 0; i < n; i++) {
        yield i * 2;
      }
    });

    const results = [];
    for (const value of tracedSyncGen(3)) {
      results.push(value);
    }

    expect(results).toEqual([0, 2, 4]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.input).toEqual([3]);
    expect(log.output).toEqual([0, 2, 4]);
    expect(log.span_attributes?.name).toBe("syncNumberGenerator");
    expect(log.span_attributes?.type).toBe("function");
  });

  test("traced sync generator with exception", async () => {
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const failingGenerator = wrapTraced(function* failingGenerator() {
      yield "first";
      yield "second";
      throw new Error("Generator failed");
    });

    const results = [];
    expect(() => {
      for (const value of failingGenerator()) {
        results.push(value);
      }
    }).toThrow("Generator failed");

    expect(results).toEqual(["first", "second"]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.output).toEqual(["first", "second"]);
    expect(log.error).toContain("Generator failed");
  });

  test("traced async generator", async () => {
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const tracedAsyncGen = wrapTraced(async function* asyncNumberGenerator(
      n: number,
    ) {
      for (let i = 0; i < n; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        yield i * 2;
      }
    });

    const results = [];
    for await (const value of tracedAsyncGen(3)) {
      results.push(value);
    }

    expect(results).toEqual([0, 2, 4]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.input).toEqual([3]);
    expect(log.output).toEqual([0, 2, 4]);
    expect(log.span_attributes?.name).toBe("asyncNumberGenerator");
  });

  test("traced async generator with exception", async () => {
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const failingAsyncGenerator = wrapTraced(
      async function* failingAsyncGenerator() {
        yield 1;
        yield 2;
        throw new Error("Something went wrong");
      },
    );

    const results = [];
    await expect(async () => {
      for await (const value of failingAsyncGenerator()) {
        results.push(value);
      }
    }).rejects.toThrow("Something went wrong");

    expect(results).toEqual([1, 2]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.output).toEqual([1, 2]);
    expect(log.error).toContain("Something went wrong");
  });

  test("traced sync generator truncation", async () => {
    process.env.BRAINTRUST_MAX_GENERATOR_ITEMS = "3";
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    const largeGenerator = wrapTraced(function* largeGenerator() {
      for (let i = 0; i < 10; i++) {
        yield i;
      }
    });

    const results = [];
    for (const value of largeGenerator()) {
      results.push(value);
    }

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Generator output exceeded limit of 3 items, output not logged. " +
        "Increase BRAINTRUST_MAX_GENERATOR_ITEMS or set to -1 to disable limit.",
    );

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.output).toBeUndefined();
    expect(log.input).toEqual([]);

    consoleWarnSpy.mockRestore();
  });

  test("traced async generator truncation", async () => {
    process.env.BRAINTRUST_MAX_GENERATOR_ITEMS = "3";
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    const largeAsyncGenerator = wrapTraced(
      async function* largeAsyncGenerator() {
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          yield i;
        }
      },
    );

    const results = [];
    for await (const value of largeAsyncGenerator()) {
      results.push(value);
    }

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Generator output exceeded limit of 3 items, output not logged. " +
        "Increase BRAINTRUST_MAX_GENERATOR_ITEMS or set to -1 to disable limit.",
    );

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.output).toBeUndefined();

    consoleWarnSpy.mockRestore();
  });

  test("traced sync generator with zero limit drops all output", async () => {
    process.env.BRAINTRUST_MAX_GENERATOR_ITEMS = "0";
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const noOutputLoggedGen = wrapTraced(function* noOutputLoggedGenerator() {
      for (let i = 0; i < 10; i++) {
        yield i;
      }
    });

    const results = [];
    for (const value of noOutputLoggedGen()) {
      results.push(value);
    }

    // Generator still yields all values
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.output).toBeUndefined(); // Output is not logged when limit is 0
  });

  test("traced sync generator with -1 limit buffers all output", async () => {
    process.env.BRAINTRUST_MAX_GENERATOR_ITEMS = "-1";
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const unlimitedBufferGen = wrapTraced(function* unlimitedBufferGenerator() {
      for (let i = 0; i < 3; i++) {
        yield i * 2;
      }
    });

    const results = [];
    for (const value of unlimitedBufferGen()) {
      results.push(value);
    }

    expect(results).toEqual([0, 2, 4]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.output).toEqual([0, 2, 4]); // All output is logged when limit is -1
  });

  test("traced sync generator with subtasks", async () => {
    initLogger({ projectName: "test", projectId: "test-project-id" });

    // Test that sync generators can perform work and use currentSpan
    const tracedAsyncGenWithSubtasks = wrapTraced(
      function* main(numLoops: number) {
        yield 1;
        currentSpan().log({ metadata: { a: "b" } });

        const tasks = [];
        for (let i = 0; i < numLoops; i++) {
          tasks.push(i * 2);
        }

        const total = tasks.reduce((sum, val) => sum + val, 0);

        currentSpan().log({
          metadata: { total },
          output: "testing",
        });
        yield total;
      },
      { name: "main", noTraceIO: true },
    );

    const results = [];
    for (const value of tracedAsyncGenWithSubtasks(3)) {
      results.push(value);
    }

    expect(results).toEqual([1, 6]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    //expect(log.output).toEqual("testing");
    expect(log.input).toBeUndefined(); // no input because noTraceIO
    expect(log.span_attributes?.name).toBe("main");
    expect(log.metadata).toEqual({ a: "b", total: 6 });
  });

  test("traced async generator with zero limit drops all output", async () => {
    process.env.BRAINTRUST_MAX_GENERATOR_ITEMS = "0";
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const noOutputLoggedAsyncGen = wrapTraced(
      async function* noOutputLoggedAsyncGenerator() {
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          yield i;
        }
      },
    );

    const results = [];
    for await (const value of noOutputLoggedAsyncGen()) {
      results.push(value);
    }

    // Generator still yields all values
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.output).toBeUndefined(); // Output is not logged when limit is 0
  });

  test("traced async generator with -1 limit buffers all output", async () => {
    process.env.BRAINTRUST_MAX_GENERATOR_ITEMS = "-1";
    initLogger({ projectName: "test", projectId: "test-project-id" });

    const unlimitedBufferAsyncGen = wrapTraced(
      async function* unlimitedBufferAsyncGenerator() {
        for (let i = 0; i < 3; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          yield i * 2;
        }
      },
    );

    const results = [];
    for await (const value of unlimitedBufferAsyncGen()) {
      results.push(value);
    }

    expect(results).toEqual([0, 2, 4]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.output).toEqual([0, 2, 4]); // All output is logged when limit is -1
  });

  test("traced async generator with subtasks", async () => {
    initLogger({ projectName: "test", projectId: "test-project-id" });

    // Test that async generators can perform async work and use currentSpan
    const tracedAsyncGenWithSubtasks = wrapTraced(
      async function* main(numLoops: number) {
        yield 1;
        currentSpan().log({ metadata: { a: "b" } });

        const tasks = [];
        for (let i = 0; i < numLoops; i++) {
          tasks.push(
            new Promise((resolve) => {
              setTimeout(() => resolve(i * 2), 1);
            }),
          );
        }

        const results = await Promise.all(tasks);
        const total = results.reduce((sum, val) => sum + val, 0);

        currentSpan().log({
          metadata: { total },
          output: "testing",
        });
        yield total;
      },
      { name: "main", noTraceIO: true },
    );

    const results = [];
    for await (const value of tracedAsyncGenWithSubtasks(3)) {
      results.push(value);
    }

    expect(results).toEqual([1, 6]);

    await memoryLogger.flush();
    const logs = await memoryLogger.drain();
    expect(logs).toHaveLength(1);

    const log = logs[0];
    expect(log.output).toEqual("testing");
    expect(log.input).toBeUndefined(); // no input because noTraceIO
    expect(log.span_attributes?.name).toBe("main");
    expect(log.metadata).toEqual({ a: "b", total: 6 });
  });
});
