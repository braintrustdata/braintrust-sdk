import { afterEach, describe, expect, test, vi } from "vitest";
import { inspect } from "node:util";
import {
  BraintrustState,
  Logger,
  TestBackgroundLogger,
  _internalGetGlobalState,
} from "../logger";
import { LazyValue } from "../util";
import { wrapConsole } from "./index";
import { consoleMethods } from "./console-interceptor";
import { configureNode } from "../node/config";
import iso from "../isomorph";
import type { ExperimentEvent } from "../util";
import { debugLogger } from "../debug-logger";
import { isApplicationLogSuppressed, suppressApplicationLogs } from "./context";

configureNode();

async function drain(
  background: TestBackgroundLogger,
): Promise<ExperimentEvent[]> {
  return (await background.drain()) as ExperimentEvent[];
}

function setup<Async extends boolean>(asyncFlush: Async) {
  const state = new BraintrustState({});
  const background = new TestBackgroundLogger();
  vi.spyOn(state, "bgLogger").mockReturnValue(background);
  const enqueue = vi.spyOn(background, "log");
  const logger = new Logger(
    state,
    new LazyValue(async () => ({
      org_id: "org",
      project: { id: "project", name: "application-logs", fullInfo: {} },
    })),
    { asyncFlush },
  );
  return { state, background, logger, enqueue };
}

function fakeConsole() {
  return {
    log: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("application logs", () => {
  test("uploads each SDK and console log once with no follow-up merge", async () => {
    const rows: ExperimentEvent[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).endsWith("/logs3")) {
        rows.push(...JSON.parse(String(init?.body)).rows);
      }
      return Response.json({});
    });
    const state = new BraintrustState({ fetch, noExitFlush: true });
    state.apiUrl = "https://api.test";
    state.orgId = "org";
    state.httpLogger().syncFlush = true;
    const logger = new Logger(
      state,
      new LazyValue(async () => ({
        org_id: "org",
        project: { id: "project", name: "test", fullInfo: {} },
      })),
      { asyncFlush: true },
    );
    const target = fakeConsole();
    const uninstrument = wrapConsole(target, { logger });
    const id = logger.info(logger.fmt`User ${"Ada"}`);
    await logger.flush();
    target.warn("Retry %d", 2);
    uninstrument();
    target.warn("Console output only");
    await logger.flush();
    await logger.flush();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id,
      output: "User Ada",
      _is_merge: false,
    });
    expect(rows[1]).toMatchObject({ output: "Retry 2", _is_merge: false });
    expect(rows[1].id).not.toBe(id);
    for (const row of rows) {
      expect(row.metrics?.end).toBe(row.metrics?.start);
      expect(row.span_attributes?.type).toBe("log");
    }
  });

  test.each(["trace", "debug", "info", "warn", "error", "fatal"] as const)(
    "%s enqueues exactly one complete row",
    async (level) => {
      const { logger, background, enqueue } = setup(true);
      const timestamp = new Date("2026-01-02T03:04:05.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(timestamp);
      try {
        const id = logger[level](logger.fmt`Worker ${3} started`, {
          metadata: { worker_id: "worker-1" },
        });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue.mock.calls[0][0]).toHaveLength(1);
        // Inspect the raw initial write before TestBackgroundLogger can merge updates.
        const row = await enqueue.mock.calls[0][0][0].get();
        expect(row).toMatchObject({
          id,
          project_id: "project",
          output: "Worker 3 started",
          _is_merge: false,
          span_attributes: { type: "log", name: null, log_level: level },
          metadata: {
            worker_id: "worker-1",
            "braintrust.template": "Worker ${0} started",
            "braintrust.template.parameter.0": 3,
          },
          created: timestamp.toISOString(),
          metrics: {
            start: timestamp.getTime() / 1000,
            end: timestamp.getTime() / 1000,
          },
        });
        await logger.flush();
        expect(await drain(background)).toHaveLength(1);
        expect(enqueue).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test("logs ordinary JSON bodies verbatim without interpreting template-like text", async () => {
    const { logger, background } = setup(true);
    const metadata = Object.freeze({ source: "app" });
    const bodies = [
      null,
      true,
      42,
      [1, "two"],
      { event: "started" },
      "User {name} paid {amount:.2f}",
    ];
    for (const body of bodies) logger.info(body, { metadata });
    const rows = await drain(background);
    expect(rows.map((row) => row.output)).toEqual(bodies);
    expect(rows.map((row) => row.metadata)).toEqual(bodies.map(() => metadata));
  });

  test("fmt captures stable templates and values without emitting or mutating metadata", async () => {
    const { logger, background, enqueue } = setup(true);
    const metadata = Object.freeze({
      source: "checkout",
      "braintrust.template": "old",
    });
    const events = [
      { userId: "user_123", amount: 12.5 },
      { userId: "user_456", amount: 8 },
    ];
    for (const [index, { userId, amount }] of events.entries()) {
      const formatted = logger.fmt`User ${userId} paid ${amount.toFixed(2)}`;
      expect(enqueue).toHaveBeenCalledTimes(index);
      logger.info(formatted, { metadata });
    }
    const rows = await drain(background);
    expect(rows.map((row) => row.output)).toEqual([
      "User user_123 paid 12.50",
      "User user_456 paid 8.00",
    ]);
    for (const [index, row] of rows.entries()) {
      expect(row.metadata).toEqual({
        source: "checkout",
        "braintrust.template": "User ${0} paid ${1}",
        "braintrust.template.parameter.0": events[index].userId,
        "braintrust.template.parameter.1": events[index].amount.toFixed(2),
      });
    }
    expect(metadata["braintrust.template"]).toBe("old");
  });

  test("fmt preserves cooked text, escaped placeholders, and interpolation boundaries", async () => {
    const { logger, background } = setup(true);
    const count = 3;
    logger.info(logger.fmt`line\n\t${count * 2}\\end`);
    logger.info(logger.fmt`literal \${value} and {braces} ${count}`);
    logger.info(logger.fmt`${"a"}${"b"}`);
    logger.info(logger.fmt`literal {braces} and no parameters`);
    const rows = await drain(background);
    expect(
      rows.map((row) => ({
        output: row.output,
        template: row.metadata?.["braintrust.template"],
      })),
    ).toEqual([
      { output: "line\n\t6\\end", template: "line\n\t${0}\\end" },
      {
        output: "literal ${value} and {braces} 3",
        template: "literal ${value} and {braces} ${0}",
      },
      { output: "ab", template: "${0}${1}" },
      {
        output: "literal {braces} and no parameters",
        template: "literal {braces} and no parameters",
      },
    ]);
  });

  test("fmt retains JSON parameter values and encodes undefined and bigint as text", async () => {
    const { logger, background } = setup(true);
    const values = [Object.freeze({ id: 42 }), false, null, 0, undefined, 123n];
    for (const value of values) logger.info(logger.fmt`${value}`);
    const rows = await drain(background);
    expect(rows.map((row) => row.output)).toEqual([
      "[object Object]",
      "false",
      "null",
      "0",
      "undefined",
      "123",
    ]);
    expect(
      rows.map((row) => row.metadata?.["braintrust.template.parameter.0"]),
    ).toEqual([{ id: 42 }, false, null, 0, "undefined", "123"]);
  });

  test("fmt coerces each interpolation only once", async () => {
    const { logger, background } = setup(true);
    const coerce = vi.fn(() => "custom value");
    logger.info(logger.fmt`value=${{ [Symbol.toPrimitive]: coerce }}`);
    expect(coerce).toHaveBeenCalledExactlyOnceWith("string");
    expect((await drain(background))[0].output).toBe("value=custom value");
  });

  test("groups standalone messages per logger with independent row and span IDs", async () => {
    const { logger, background, state } = setup(true);
    logger.info("one");
    logger.warn("two");
    const other = new Logger(
      state,
      new LazyValue(async () => ({
        org_id: "org",
        project: { id: "project", name: "test", fullInfo: {} },
      })),
      { asyncFlush: true },
    );
    other.info("three");
    const [one, two, three] = await drain(background);
    expect(one.id).not.toBe(two.id);
    expect(one.span_id).not.toBe(two.span_id);
    expect(one.root_span_id).toBe(two.root_span_id);
    expect(three.root_span_id).not.toBe(one.root_span_id);
    expect(one.span_parents).toEqual([]);
  });

  test("correlates SDK and console logs across awaits without modifying the active span", async () => {
    const { logger, background, state } = setup(true);
    const target = fakeConsole();
    const uninstrument = wrapConsole(target, { logger });
    const root = logger.startSpan({ name: "request" });
    await state.contextManager.runInContext(root, async () => {
      logger.info("one");
      await Promise.resolve();
      target.error("two");
      expect(state.contextManager.getCurrentSpan()).toBe(root);
    });
    root.end();
    const rows = await drain(background);
    const logs = rows.filter((row) => row.span_attributes?.type === "log");
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.id).not.toBe(root.id);
      expect(log.span_id).toBe(root.spanId);
      expect(log.root_span_id).toBe(root.rootSpanId);
      expect(log.span_parents).toEqual([]);
    }
    expect(state.contextManager.getCurrentSpan()).toBeUndefined();
    expect(rows.find((row) => row.id === root.id)?.span_attributes?.name).toBe(
      "request",
    );
    uninstrument();
    // Application log methods remain usable after span APIs have been used.
    expect(() => logger.info("outside")).not.toThrow();
  });

  test("uses context-manager IDs even without a native Braintrust span", async () => {
    const { logger, background, state } = setup(true);
    vi.spyOn(state.contextManager, "getParentSpanIds").mockReturnValue({
      rootSpanId: "otel-trace",
      spanParents: ["otel-span"],
    });
    logger.info("otel");
    expect((await drain(background))[0]).toMatchObject({
      root_span_id: "otel-trace",
      span_id: "otel-span",
    });
  });

  test("waits for flush when asyncFlush is false", async () => {
    const { logger, background, enqueue } = setup(false);
    let finishFlush!: () => void;
    const flush = vi.spyOn(background, "flush").mockReturnValue(
      new Promise<void>((resolve) => {
        finishFlush = resolve;
      }),
    );
    const pending = logger.info("synchronous");
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishFlush();
    const id = await pending;
    expect(flush).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((await drain(background))[0].id).toBe(id);
  });
});

describe("wrapConsole", () => {
  test.each([
    ["log", "info"],
    ["trace", "trace"],
    ["debug", "debug"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ] as const)(
    "maps console.%s to %s and preserves output before and after cleanup",
    async (method, level) => {
      const { logger, background, enqueue } = setup(true);
      const target = fakeConsole();
      const original = target[method];
      const uninstrument = wrapConsole(target, { logger });
      target[method]("message");
      expect(original).toHaveBeenCalledExactlyOnceWith("message");
      expect(original.mock.contexts[0]).toBe(target);
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect((await drain(background))[0]).toMatchObject({
        output: "message",
        span_attributes: { log_level: level },
      });
      uninstrument();
      target[method]("console only");
      expect(original).toHaveBeenCalledTimes(2);
      expect(original).toHaveBeenLastCalledWith("console only");
      expect(enqueue).toHaveBeenCalledTimes(1);
    },
  );

  test("wrapConsole() follows logger initialization and replacement until cleanup", async () => {
    const first = setup(false);
    const second = setup(false);
    const state = _internalGetGlobalState();
    const previousLogger = state.currentLogger;
    const methods = consoleMethods.map(
      (method) => [method, console[method]] as const,
    );
    const original = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      state.currentLogger = undefined;
      const uninstrument = wrapConsole();
      console.info("before initialization");
      expect(first.enqueue).not.toHaveBeenCalled();
      state.currentLogger = first.logger;
      console.info("captured by first logger");
      state.currentLogger = second.logger;
      console.info("captured by second logger");
      expect(first.enqueue).toHaveBeenCalledTimes(1);
      expect(second.enqueue).toHaveBeenCalledTimes(1);
      expect(original).toHaveBeenCalledTimes(3);
      expect((await drain(first.background)).map((row) => row.output)).toEqual([
        "captured by first logger",
      ]);
      expect((await drain(second.background))[0].output).toBe(
        "captured by second logger",
      );
      uninstrument();
      console.info("Console output only");
      expect(original).toHaveBeenCalledTimes(4);
      expect(second.enqueue).toHaveBeenCalledTimes(1);
    } finally {
      state.currentLogger = previousLogger;
      for (const [method, original] of methods) console[method] = original;
    }
  });

  test("an older cleanup cannot disable a newer wrap or resume an older destination", async () => {
    const first = setup(true);
    const second = setup(true);
    const target = fakeConsole();
    const original = target.info;
    const stopFirst = wrapConsole(target, { logger: first.logger });
    target.info("first");
    const wrapped = target.info;
    const stopSecond = wrapConsole(target, { logger: second.logger });
    expect(target.info).toBe(wrapped);
    stopFirst();
    stopFirst();
    target.info("second");
    stopSecond();
    stopSecond();
    target.info("console only");
    expect(original).toHaveBeenCalledTimes(3);
    expect((await drain(first.background)).map((row) => row.output)).toEqual([
      "first",
    ]);
    expect((await drain(second.background)).map((row) => row.output)).toEqual([
      "second",
    ]);
  });

  test("wrapping after cleanup re-enables forwarding without replacing the installed methods", async () => {
    const { logger, background, enqueue } = setup(true);
    const target = fakeConsole();
    const stopFirst = wrapConsole(target, { logger });
    const wrapped = target.info;
    stopFirst();
    const stopSecond = wrapConsole(target, { logger });
    expect(target.info).toBe(wrapped);
    stopFirst();
    target.info("captured again");
    stopSecond();
    target.info("console only");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((await drain(background))[0].output).toBe("captured again");
  });

  test("cleanup affects only its console; direct logging and unrelated methods stay enabled", async () => {
    const first = setup(true);
    const second = setup(true);
    const time = vi.fn();
    const firstConsole = { ...fakeConsole(), time };
    const secondConsole = fakeConsole();
    const stopFirst = wrapConsole(firstConsole, { logger: first.logger });
    const stopSecond = wrapConsole(secondConsole, { logger: second.logger });
    expect(firstConsole.time).toBe(time);
    stopFirst();
    firstConsole.info("console only");
    secondConsole.info("other console");
    first.logger.info("direct logger call");
    stopSecond();
    expect((await drain(first.background)).map((row) => row.output)).toEqual([
      "direct logger call",
    ]);
    expect((await drain(second.background)).map((row) => row.output)).toEqual([
      "other console",
    ]);
  });

  test("nested wrapping captures once and cleanup preserves third-party patches without reviving older capture", () => {
    const first = setup(true);
    const second = setup(true);
    const target = fakeConsole();
    const original = target.info;
    const stopFirst = wrapConsole(target, { logger: first.logger });
    const firstWrapper = target.info;
    target.info = vi.fn((...args) => firstWrapper(...args));
    const stopSecond = wrapConsole(target, { logger: second.logger });
    target.info("captured once");
    expect(first.enqueue).not.toHaveBeenCalled();
    expect(second.enqueue).toHaveBeenCalledTimes(1);
    const secondWrapper = target.info;
    const thirdParty = vi.fn((...args) => secondWrapper(...args));
    target.info = thirdParty;
    stopSecond();
    expect(target.info).toBe(thirdParty);
    target.info("console only");
    expect(thirdParty).toHaveBeenCalledExactlyOnceWith("console only");
    expect(original).toHaveBeenCalledTimes(2);
    expect(original).toHaveBeenLastCalledWith("console only");
    expect(first.enqueue).not.toHaveBeenCalled();
    expect(second.enqueue).toHaveBeenCalledTimes(1);
    stopFirst();
  });

  test("does not duplicate calls when native console methods call one another", () => {
    const { logger, enqueue } = setup(true);
    const target = fakeConsole();
    target.trace.mockImplementation((...args) => target.error(...args));
    wrapConsole(target, { logger });
    target.trace("one log");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test("preserves native exceptions and does not retry the console call", () => {
    const { logger } = setup(true);
    const target = fakeConsole();
    const error = new Error("console failure");
    const original = target.info.mockImplementation(() => {
      throw error;
    });
    wrapConsole(target, { logger });
    expect(() => target.info("test")).toThrow(error);
    expect(original).toHaveBeenCalledTimes(1);
  });

  test("preserves console formatting, parameters, errors, and unformattable arguments", async () => {
    const { logger, background } = setup(true);
    const target = fakeConsole();
    wrapConsole(target, { logger });
    target.info("Payment %s attempt %d", "pay_123", 2);
    target.error(new Error("payment failed"));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    target.info("value %o", circular);
    target.info("value %o", {
      [inspect.custom]() {
        throw new Error("bad inspector");
      },
    });
    const rows = await drain(background);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      output: "Payment pay_123 attempt 2",
      metadata: {
        "logger.name": "console",
        "braintrust.template": "Payment %s attempt %d",
        "braintrust.template.parameter.0": "pay_123",
        "braintrust.template.parameter.1": 2,
      },
    });
    expect(rows[1].output).toContain("Error: payment failed");
    expect(rows[2].output).toContain("Circular");
    expect(rows[3].output).toBe("[Unformattable console message]");
  });

  test("preserves console arguments as text when there is no native formatter", async () => {
    const { logger, background } = setup(true);
    const target = fakeConsole();
    wrapConsole(target, { logger });
    const format = iso.formatLogMessage;
    iso.formatLogMessage = undefined;
    try {
      target.info("Payment %s %d %%", "pay_123", 2, { attempt: 1 });
    } finally {
      iso.formatLogMessage = format;
    }
    expect((await drain(background))[0].output).toBe(
      'Payment %s %d %% pay_123 2 {"attempt":1}',
    );
  });

  test("SDK diagnostics are printed without becoming application logs", () => {
    const { logger, enqueue } = setup(true);
    const sdkState = _internalGetGlobalState();
    vi.spyOn(sdkState, "getDebugLogLevel").mockReturnValue("warn");
    vi.spyOn(sdkState, "hasDebugLogLevelOverride").mockReturnValue(true);
    const methods = consoleMethods.map(
      (method) => [method, console[method]] as const,
    );
    const original = vi.spyOn(console, "warn").mockImplementation(() => {});
    const uninstrument = wrapConsole(console, { logger });
    try {
      debugLogger.warn("SDK warning");
      expect(debugLogger.notice.warn("SDK notice")).toBe(true);
      expect(original).toHaveBeenCalledTimes(2);
      expect(original).toHaveBeenCalledWith("[braintrust]", "SDK warning");
      expect(original).toHaveBeenCalledWith("[braintrust]", "SDK notice");
      expect(enqueue).not.toHaveBeenCalled();
      console.warn("application log");
      expect(enqueue).toHaveBeenCalledTimes(1);
    } finally {
      uninstrument();
      for (const [method, original] of methods) console[method] = original;
    }
  });

  test("bootstrap diagnostics do not prevent async suppression after platform initialization", async () => {
    const key = Symbol.for("braintrust.applicationLogContext");
    const previousContext = Object.getOwnPropertyDescriptor(globalThis, key);
    const previousBuildType = iso.buildType;
    Reflect.deleteProperty(globalThis, key);
    try {
      iso.buildType = "unknown";
      suppressApplicationLogs(() =>
        expect(isApplicationLogSuppressed()).toBe(true),
      );
      expect(isApplicationLogSuppressed()).toBe(false);
      iso.buildType = previousBuildType;
      await suppressApplicationLogs(async () => {
        await Promise.resolve();
        expect(isApplicationLogSuppressed()).toBe(true);
      });
      expect(isApplicationLogSuppressed()).toBe(false);
    } finally {
      iso.buildType = previousBuildType;
      if (previousContext)
        Object.defineProperty(globalThis, key, previousContext);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  test("ignores console logs inside SDK HTTP transport across awaits but captures concurrent application logs", async () => {
    const { logger, background, state } = setup(true);
    const target = fakeConsole();
    wrapConsole(target, { logger });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.setFetch(async () => {
      target.debug("transport start");
      await pending;
      target.debug("transport end");
      return new Response("{}", { status: 200 });
    });
    state.apiUrl = "https://example.com";
    const response = state.apiConn().post("logs3", {});
    target.info("application");
    release();
    await response;
    const rows = await drain(background);
    expect(rows).toHaveLength(1);
    expect(rows[0].output).toBe("application");
  });
});
