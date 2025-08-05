/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  _exportsForTestingOnly,
  initLogger,
  wrapTraced,
  currentSpan,
} from "./logger";
import { configureNode } from "./node";

configureNode();

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
