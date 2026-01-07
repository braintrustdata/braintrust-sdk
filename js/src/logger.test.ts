/* eslint-disable @typescript-eslint/consistent-type-assertions */
import type {
  ChatCompletionContentPartText,
  ChatCompletionContentPartImage,
} from "openai/resources";
import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  _exportsForTestingOnly,
  init,
  initLogger,
  Prompt,
  BraintrustState,
  wrapTraced,
  currentSpan,
  withParent,
  startSpan,
  Attachment,
  ReadonlyAttachment,
  deepCopyEvent,
  renderMessage,
} from "./logger";
import {
  parseTemplateFormat,
  isTemplateFormat,
  renderTemplateContent,
} from "./template/renderer";
import { configureNode } from "./node";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SpanComponentsV3 } from "../util/span_identifier_v3";

configureNode();

function getExportVersion(exportedSpan: string): number {
  const exportedBytes = base64ToUint8Array(exportedSpan);
  return exportedBytes[0];
}

test("renderMessage with file content parts", () => {
  const message = {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: "Here is a {{item}}:",
      },
      {
        type: "image_url" as const,
        image_url: {
          url: "{{image_url}}",
        },
      },
      {
        type: "file" as const,
        file: {
          file_data: "{{file_data}}",
          file_id: "{{file_id}}",
          filename: "{{filename}}",
        },
      },
    ],
  };

  const rendered = renderMessage(
    (template) =>
      template
        .replace("{{item}}", "document")
        .replace("{{image_url}}", "https://example.com/image.png")
        .replace("{{file_data}}", "base64data")
        .replace("{{file_id}}", "file-456")
        .replace("{{filename}}", "report.pdf"),
    message,
  );

  expect(rendered.content).toEqual([
    {
      type: "text",
      text: "Here is a document:",
    },
    {
      type: "image_url",
      image_url: {
        url: "https://example.com/image.png",
      },
    },
    {
      type: "file",
      file: {
        file_data: "base64data",
        file_id: "file-456",
        filename: "report.pdf",
      },
    },
  ]);
});

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

describe("prompt.build structured output templating", () => {
  test("applies nunjucks templating inside schema", () => {
    const prompt = new Prompt<false, false>(
      {
        name: "Greeter",
        slug: "greeter",
        project_id: "p",
        prompt_data: {
          prompt: {
            type: "chat",
            messages: [
              {
                role: "system",
                content: "Greet the user.",
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
                  schema: {
                    type: "object",
                    properties: {
                      greeting: {
                        type: "string",
                        description: "Hello {{ user.name | upper }}",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {},
      false,
    );

    const result = prompt.build(
      {
        user: { name: "ada" },
      },
      { templateFormat: "nunjucks" },
    );

    expect(result).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "schema",
          schema: {
            type: "object",
            properties: {
              greeting: {
                type: "string",
                description: "Hello ADA",
              },
            },
          },
        },
      },
    });
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
    _exportsForTestingOnly.simulateLogoutForTests();
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

describe("parent precedence", () => {
  let memory: any;

  beforeEach(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
    memory = _exportsForTestingOnly.useTestBackgroundLogger();
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
    _exportsForTestingOnly.simulateLogoutForTests();
  });

  test("withParent + wrapTraced: child spans attach to current span (not directly to withParent)", async () => {
    const logger = initLogger({ projectName: "test", projectId: "pid" });
    const outer = logger.startSpan({ name: "outer" });
    const parentStr = await outer.export();
    outer.end();

    const inner = wrapTraced(
      async function inner() {
        startSpan({ name: "child" }).end();
      },
      { name: "inner" },
    );

    await withParent(parentStr, () => inner());

    await memory.flush();
    const events = await memory.drain();
    const byName: any = Object.fromEntries(
      events.map((e: any) => [e.span_attributes?.name, e]),
    );

    expect(byName.outer).toBeTruthy();
    expect(byName.inner).toBeTruthy();
    expect(byName.child).toBeTruthy();

    expect(byName.child.span_parents || []).toContain(byName.inner.span_id);
    expect(byName.child.root_span_id).toBe(byName.outer.root_span_id);
  });

  test("wrapTraced baseline: child spans attach to current span", async () => {
    initLogger({ projectName: "test", projectId: "pid" });

    const top = wrapTraced(
      async function top() {
        startSpan({ name: "child" }).end();
      },
      { name: "top" },
    );

    await top();

    await memory.flush();
    const events = await memory.drain();
    const byName: any = Object.fromEntries(
      events.map((e: any) => [e.span_attributes?.name, e]),
    );
    expect(byName.child.span_parents).toContain(byName.top.span_id);
  });

  test("explicit parent overrides current span", async () => {
    const logger = initLogger({ projectName: "test", projectId: "pid" });
    const outer = logger.startSpan({ name: "outer" });
    const parentStr = await outer.export();
    outer.end();

    const inner = wrapTraced(
      async function inner() {
        startSpan({ name: "forced", parent: parentStr }).end();
      },
      { name: "inner" },
    );

    await inner();

    await memory.flush();
    const events = await memory.drain();
    const byName: any = Object.fromEntries(
      events.map((e: any) => [e.span_attributes?.name, e]),
    );
    expect(byName.forced.span_parents).toContain(byName.outer.span_id);
    expect(byName.forced.span_parents).not.toContain(byName.inner.span_id);
  });
});

test("attachment with unreadable path logs warning", () => {
  const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  new Attachment({
    data: "unreadable.txt",
    filename: "unreadable.txt",
    contentType: "text/plain",
  });

  expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  expect(consoleWarnSpy).toHaveBeenCalledWith(
    expect.stringMatching(/Failed to read file:/),
  );

  consoleWarnSpy.mockRestore();
});

test("attachment with readable path returns data", async () => {
  const tmpFile = join(
    tmpdir(),
    `bt-attach-${Date.now()}-${Math.random()}.txt`,
  );
  await writeFile(tmpFile, "hello world", "utf8");
  try {
    const a = new Attachment({
      data: tmpFile,
      filename: "file.txt",
      contentType: "text/plain",
    });
    const blob = await a.data();
    const text = await blob.text();
    expect(text).toBe("hello world");
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
});

describe("sensitive data redaction", () => {
  let logger: any;
  let state: BraintrustState;
  let memoryLogger: any;

  beforeEach(async () => {
    state = await _exportsForTestingOnly.simulateLoginForTests();
    memoryLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    logger = initLogger({ projectName: "test", projectId: "test-id" });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
    _exportsForTestingOnly.simulateLogoutForTests();
  });

  test("SpanImpl redacts sensitive data in console.log", () => {
    const span = logger.startSpan({ name: "test-span" });

    // Test custom inspect method (used by console.log in Node.js)
    const inspectResult = (span as any)[
      Symbol.for("nodejs.util.inspect.custom")
    ]();
    expect(inspectResult).toContain("SpanImpl");
    expect(inspectResult).toContain("kind:");
    expect(inspectResult).toContain("id:");
    expect(inspectResult).toContain("spanId:");
    expect(inspectResult).toContain("rootSpanId:");
    // Should NOT contain sensitive data
    expect(inspectResult).not.toContain("_state");
    expect(inspectResult).not.toContain("loginToken");
    expect(inspectResult).not.toContain("_apiConn");

    span.end();
  });

  test("SpanImpl toString provides minimal info", () => {
    const span = logger.startSpan({ name: "test-span" });

    const str = span.toString();
    expect(str).toContain("SpanImpl");
    expect(str).toContain(span.id);
    expect(str).toContain(span.spanId);
    // Should be concise
    expect(str.length).toBeLessThan(200);

    span.end();
  });

  test("BraintrustState redacts loginToken and connections", () => {
    // Test custom inspect method
    const inspectResult = state[Symbol.for("nodejs.util.inspect.custom")]();
    expect(inspectResult).toContain("BraintrustState");
    expect(inspectResult).toContain("orgId:");
    expect(inspectResult).toContain("orgName:");
    expect(inspectResult).toContain("loginToken: '[REDACTED]'");
    // Should NOT contain actual token
    expect(inspectResult).not.toContain("___TEST_API_KEY__THIS_IS_NOT_REAL___");
    expect(inspectResult).not.toContain("_apiConn");
    expect(inspectResult).not.toContain("_appConn");
    expect(inspectResult).not.toContain("_proxyConn");
  });

  test("BraintrustState toJSON excludes sensitive data", () => {
    const json = state.toJSON();
    expect(json).toHaveProperty("id");
    expect(json).toHaveProperty("orgId", "test-org-id");
    expect(json).toHaveProperty("orgName", "test-org-name");
    expect(json).toHaveProperty("loggedIn", true);
    // Should NOT have sensitive properties
    expect(json).not.toHaveProperty("loginToken");
    expect(json).not.toHaveProperty("_apiConn");
    expect(json).not.toHaveProperty("_appConn");
    expect(json).not.toHaveProperty("_proxyConn");
    expect(json).not.toHaveProperty("_bgLogger");
  });

  test("BraintrustState toString provides minimal info", () => {
    const str = state.toString();
    expect(str).toContain("BraintrustState");
    expect(str).toContain("test-org-name");
    expect(str).toContain("loggedIn=true");
    // Should NOT contain token
    expect(str).not.toContain("___TEST_API_KEY__THIS_IS_NOT_REAL___");
    expect(str.length).toBeLessThan(150);
  });

  test("redaction works in nested objects and JSON.stringify", () => {
    const span = logger.startSpan({ name: "test-span" });

    // Create a nested object containing sensitive objects
    const nestedObj = {
      message: "test",
      span: span,
      state: state,
      connection: state.apiConn(),
      timestamp: new Date().toISOString(),
    };

    // JSON.stringify should use toJSON methods
    const jsonStr = JSON.stringify(nestedObj, null, 2);
    expect(jsonStr).toContain('"message": "test"');
    expect(jsonStr).toContain('"kind": "span"');
    expect(jsonStr).toContain('"orgName": "test-org-name"');
    // Should NOT contain sensitive data
    expect(jsonStr).not.toContain("loginToken");
    expect(jsonStr).not.toContain("___TEST_API_KEY__THIS_IS_NOT_REAL___");
    expect(jsonStr).not.toContain("_apiConn");
    expect(jsonStr).not.toContain("Authorization");

    span.end();
  });

  test("redaction works with util.inspect", async () => {
    const util = await import("util");
    const span = logger.startSpan({ name: "test-span" });

    // util.inspect should use Symbol.for("nodejs.util.inspect.custom")
    const inspected = util.inspect(span);
    expect(inspected).toContain("SpanImpl");
    expect(inspected).toContain("kind:");
    expect(inspected).not.toContain("_state");
    expect(inspected).not.toContain("loginToken");

    span.end();
  });

  test("export() still returns proper serialization for spans", async () => {
    const span = logger.startSpan({ name: "test-span" });

    // export() should still work and return a string
    const exported = await span.export();
    expect(typeof exported).toBe("string");
    expect(exported.length).toBeGreaterThan(0);

    // The exported string should be parseable by SpanComponentsV3
    const components = SpanComponentsV3.fromStr(exported);
    expect(components.data.row_id).toBe(span.id);
    expect(components.data.span_id).toBe(span.spanId);
    expect(components.data.root_span_id).toBe(span.rootSpanId);

    span.end();
  });

  test("exported span can be used as parent", async () => {
    const parentSpan = logger.startSpan({ name: "parent-span" });
    const exported = await parentSpan.export();
    parentSpan.end();

    // Should be able to use exported string as parent
    const childSpan = logger.startSpan({
      name: "child-span",
      parent: exported,
    });

    expect(childSpan.rootSpanId).toBe(parentSpan.rootSpanId);
    childSpan.end();
  });

  test("copied span values are stripped", async () => {
    const span = logger.startSpan({ name: "parent-span" });
    // I'm not entirely sure why a span may be inside of a background event, but just in case
    const copy = deepCopyEvent({ input: span });
    expect(copy.input).toBe("<span>");
  });
});

describe("buildWithAttachments - attachment arrays in templates", () => {
  // Helper to create a minimal 1x1 PNG image
  const createPngBlob = () => {
    // Minimal 1x1 transparent PNG
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    return new Blob([pngBytes], { type: "image/png" });
  };

  const createPdfBlob = () => {
    const pdfContent =
      "%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000053 00000 n\n0000000102 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%EOF";
    return new Blob([pdfContent], { type: "application/pdf" });
  };

  const createPromptWithTemplate = (
    template: string,
    templateFormat: "mustache" | "nunjucks",
  ) => {
    return new Prompt(
      {
        id: "test-prompt-1",
        _xact_id: "xact_123",
        created: "2023-10-01T00:00:00Z",
        project_id: "project_123",
        prompt_session_id: "session_123",
        name: "test",
        slug: "test",
        prompt_data: {
          template_format: templateFormat,
          options: { model: "gpt-4o" },
          prompt: {
            type: "chat",
            messages: [
              {
                role: "user",
                content: template,
              },
            ],
          },
        },
      },
      {},
      true,
    );
  };

  test("single image in template - mustache", async () => {
    const pngBlob = createPngBlob();
    const attachment = new Attachment({
      data: pngBlob,
      filename: "test.png",
      contentType: "image/png",
    });

    const prompt = createPromptWithTemplate("{{image}}", "mustache");
    const result = await prompt.buildWithAttachments({ image: attachment });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("image_url");
    expect(content[0].image_url?.url).toMatch(/^data:image\/png;base64,/);
  });

  test("single image in template - nunjucks", async () => {
    const pngBlob = createPngBlob();
    const attachment = new Attachment({
      data: pngBlob,
      filename: "test.png",
      contentType: "image/png",
    });

    const prompt = createPromptWithTemplate("{{image}}", "nunjucks");
    const result = await prompt.buildWithAttachments({ image: attachment });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("image_url");
    expect(content[0].image_url?.url).toMatch(/^data:image\/png;base64,/);
  });

  test("array of images with loop - mustache", async () => {
    const pngBlob1 = createPngBlob();
    const pngBlob2 = createPngBlob();
    const attachment1 = new Attachment({
      data: pngBlob1,
      filename: "test1.png",
      contentType: "image/png",
    });
    const attachment2 = new Attachment({
      data: pngBlob2,
      filename: "test2.png",
      contentType: "image/png",
    });

    const prompt = createPromptWithTemplate(
      "{{#images}}{{.}}{{/images}}",
      "mustache",
    );
    const result = await prompt.buildWithAttachments({
      images: [attachment1, attachment2],
    });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image_url");
    expect(content[1].type).toBe("image_url");
    expect(content[0].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(content[1].image_url?.url).toMatch(/^data:image\/png;base64,/);
  });

  test("array of images with loop - nunjucks", async () => {
    const pngBlob1 = createPngBlob();
    const pngBlob2 = createPngBlob();
    const attachment1 = new Attachment({
      data: pngBlob1,
      filename: "test1.png",
      contentType: "image/png",
    });
    const attachment2 = new Attachment({
      data: pngBlob2,
      filename: "test2.png",
      contentType: "image/png",
    });

    const prompt = createPromptWithTemplate(
      "{% for img in images %}{{img}}{% endfor %}",
      "nunjucks",
    );
    const result = await prompt.buildWithAttachments({
      images: [attachment1, attachment2],
    });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image_url");
    expect(content[1].type).toBe("image_url");
    expect(content[0].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(content[1].image_url?.url).toMatch(/^data:image\/png;base64,/);
  });

  test("mixed text and attachments - mustache", async () => {
    const pngBlob = createPngBlob();
    const attachment = new Attachment({
      data: pngBlob,
      filename: "test.png",
      contentType: "image/png",
    });

    const prompt = createPromptWithTemplate(
      "Here is the image: {{img}} and some text after",
      "mustache",
    );
    const result = await prompt.buildWithAttachments({ img: attachment });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(content).toHaveLength(3);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("Here is the image: ");
    expect(content[1].type).toBe("image_url");
    expect(content[1].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(content[2].type).toBe("text");
    expect(content[2].text).toBe(" and some text after");
  });

  test("mixed text and attachments - nunjucks", async () => {
    const pngBlob = createPngBlob();
    const attachment = new Attachment({
      data: pngBlob,
      filename: "test.png",
      contentType: "image/png",
    });

    const prompt = createPromptWithTemplate(
      "Here is the image: {{img}} and some text after",
      "nunjucks",
    );
    const result = await prompt.buildWithAttachments({ img: attachment });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(content).toHaveLength(3);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("Here is the image: ");
    expect(content[1].type).toBe("image_url");
    expect(content[1].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(content[2].type).toBe("text");
    expect(content[2].text).toBe(" and some text after");
  });

  test("file vs image detection - mustache", async () => {
    const pngBlob = createPngBlob();
    const pdfBlob = createPdfBlob();
    const imageAttachment = new Attachment({
      data: pngBlob,
      filename: "test.png",
      contentType: "image/png",
    });
    const fileAttachment = new Attachment({
      data: pdfBlob,
      filename: "test.pdf",
      contentType: "application/pdf",
    });

    const prompt = createPromptWithTemplate("{{image}}{{file}}", "mustache");
    const result = await prompt.buildWithAttachments({
      image: imageAttachment,
      file: fileAttachment,
    });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{
      type: string;
      image_url?: { url: string };
      file?: { file_data: string; filename: string };
    }>;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image_url");
    expect(content[0].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(content[1].type).toBe("file");
    expect(content[1].file?.file_data).toMatch(
      /^data:application\/pdf;base64,/,
    );
    expect(content[1].file?.filename).toBe("test.pdf");
  });

  test("file vs image detection - nunjucks", async () => {
    const pngBlob = createPngBlob();
    const pdfBlob = createPdfBlob();
    const imageAttachment = new Attachment({
      data: pngBlob,
      filename: "test.png",
      contentType: "image/png",
    });
    const fileAttachment = new Attachment({
      data: pdfBlob,
      filename: "test.pdf",
      contentType: "application/pdf",
    });

    const prompt = createPromptWithTemplate("{{image}}{{file}}", "nunjucks");
    const result = await prompt.buildWithAttachments({
      image: imageAttachment,
      file: fileAttachment,
    });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{
      type: string;
      image_url?: { url: string };
      file?: { file_data: string; filename: string };
    }>;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image_url");
    expect(content[0].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(content[1].type).toBe("file");
    expect(content[1].file?.file_data).toMatch(
      /^data:application\/pdf;base64,/,
    );
    expect(content[1].file?.filename).toBe("test.pdf");
  });

  test("empty/whitespace text filtering - mustache", async () => {
    const pngBlob1 = createPngBlob();
    const pngBlob2 = createPngBlob();
    const attachment1 = new Attachment({
      data: pngBlob1,
      filename: "test1.png",
      contentType: "image/png",
    });
    const attachment2 = new Attachment({
      data: pngBlob2,
      filename: "test2.png",
      contentType: "image/png",
    });

    const prompt = createPromptWithTemplate("{{img1}}   {{img2}}", "mustache");
    const result = await prompt.buildWithAttachments({
      img1: attachment1,
      img2: attachment2,
    });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{ type: string }>;
    // Should only have 2 image parts, whitespace should be filtered out
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image_url");
    expect(content[1].type).toBe("image_url");
  });

  test("empty/whitespace text filtering - nunjucks", async () => {
    const pngBlob1 = createPngBlob();
    const pngBlob2 = createPngBlob();
    const attachment1 = new Attachment({
      data: pngBlob1,
      filename: "test1.png",
      contentType: "image/png",
    });
    const attachment2 = new Attachment({
      data: pngBlob2,
      filename: "test2.png",
      contentType: "image/png",
    });

    const prompt = createPromptWithTemplate("{{img1}}   {{img2}}", "nunjucks");
    const result = await prompt.buildWithAttachments({
      img1: attachment1,
      img2: attachment2,
    });

    expect(Array.isArray(result.messages[0].content)).toBe(true);
    const content = result.messages[0].content as Array<{ type: string }>;
    // Should only have 2 image parts, whitespace should be filtered out
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image_url");
    expect(content[1].type).toBe("image_url");
  });

  test("plain string data URLs not transformed - mustache", async () => {
    const fakeDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const prompt = createPromptWithTemplate(
      "Here is a string: {{url}}",
      "mustache",
    );
    const result = await prompt.buildWithAttachments({ url: fakeDataUrl });

    // Since this data URL didn't come from an attachment, it should remain as text
    expect(
      typeof result.messages[0].content === "string" ||
        Array.isArray(result.messages[0].content),
    ).toBe(true);
    if (Array.isArray(result.messages[0].content)) {
      const content = result.messages[0].content as Array<{
        type: string;
        text?: string;
      }>;
      expect(content.every((part) => part.type === "text")).toBe(true);
    }
  });

  test("plain string data URLs not transformed - nunjucks", async () => {
    const fakeDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const prompt = createPromptWithTemplate(
      "Here is a string: {{url}}",
      "nunjucks",
    );
    const result = await prompt.buildWithAttachments({ url: fakeDataUrl });

    // Since this data URL didn't come from an attachment, it should remain as text
    expect(
      typeof result.messages[0].content === "string" ||
        Array.isArray(result.messages[0].content),
    ).toBe(true);
    if (Array.isArray(result.messages[0].content)) {
      const content = result.messages[0].content as Array<{
        type: string;
        text?: string;
      }>;
      expect(content.every((part) => part.type === "text")).toBe(true);
    }
  });

  test("no attachments baseline - mustache", async () => {
    const prompt = createPromptWithTemplate("Hello {{name}}", "mustache");
    const result = await prompt.buildWithAttachments({ name: "World" });

    expect(typeof result.messages[0].content).toBe("string");
    expect(result.messages[0].content).toBe("Hello World");
  });

  test("no attachments baseline - nunjucks", async () => {
    const prompt = createPromptWithTemplate("Hello {{name}}", "nunjucks");
    const result = await prompt.buildWithAttachments({ name: "World" });

    expect(typeof result.messages[0].content).toBe("string");
    expect(result.messages[0].content).toBe("Hello World");
  });
});

describe("Prompt.hydrateAttachmentReferences", () => {
  test("handles inline_attachment format", () => {
    const input = {
      type: "inline_attachment",
      content_type: "image/png",
      filename: "test.png",
      src: "https://example.com/image.png",
    };

    const result = Prompt.hydrateAttachmentReferences(input);

    expect(result).toEqual({
      __inline_url__: true,
      url: "https://example.com/image.png",
      content_type: "image/png",
      filename: "test.png",
    });
  });

  test("handles braintrust_attachment format", () => {
    const state = new BraintrustState({});
    const input = {
      type: "braintrust_attachment",
      content_type: "image/jpeg",
      filename: "photo.jpg",
      key: "s3://bucket/path/photo.jpg",
    };

    const result = Prompt.hydrateAttachmentReferences(input, state);

    // Result should be a ReadonlyAttachment
    expect(result).toBeInstanceOf(ReadonlyAttachment);
  });

  test("handles wrapped attachment reference format", () => {
    const state = new BraintrustState({});
    const input = {
      reference: {
        type: "braintrust_attachment",
        content_type: "application/pdf",
        filename: "document.pdf",
        key: "s3://bucket/path/document.pdf",
      },
    };

    const result = Prompt.hydrateAttachmentReferences(input, state);

    // Result should be a ReadonlyAttachment
    expect(result).toBeInstanceOf(ReadonlyAttachment);
  });

  test("handles arrays with mixed attachment types", () => {
    const state = new BraintrustState({});
    const input = [
      {
        type: "inline_attachment",
        content_type: "image/png",
        filename: "img1.png",
        src: "https://example.com/img1.png",
      },
      {
        type: "braintrust_attachment",
        content_type: "image/jpeg",
        filename: "img2.jpg",
        key: "s3://bucket/img2.jpg",
      },
      "regular string",
    ];

    const result = Prompt.hydrateAttachmentReferences(input, state);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    // First should be inline URL wrapper
    expect(result[0]).toMatchObject({
      __inline_url__: true,
      url: "https://example.com/img1.png",
    });
    // Second should be ReadonlyAttachment
    expect(result[1]).toBeInstanceOf(ReadonlyAttachment);
    // Third should be unchanged
    expect(result[2]).toBe("regular string");
  });

  test("handles nested objects with attachments", () => {
    const state = new BraintrustState({});
    const input = {
      images: [
        {
          type: "inline_attachment",
          content_type: "image/png",
          filename: "nested.png",
          src: "https://example.com/nested.png",
        },
      ],
      text: "Some text",
    };

    const result = Prompt.hydrateAttachmentReferences(input, state);

    expect(result.text).toBe("Some text");
    expect(result.images[0]).toMatchObject({
      __inline_url__: true,
      url: "https://example.com/nested.png",
    });
  });

  test("preserves non-attachment objects", () => {
    const input = {
      regular: "object",
      with: "properties",
      number: 42,
    };

    const result = Prompt.hydrateAttachmentReferences(input);

    expect(result).toEqual(input);
  });
});
