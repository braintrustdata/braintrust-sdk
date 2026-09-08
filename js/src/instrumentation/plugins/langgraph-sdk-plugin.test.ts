import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { _exportsForTestingOnly, initLogger } from "../../logger";
import { configureNode } from "../../node/config";
import { wrapLangGraphSDK } from "../../wrappers/langgraph-sdk";
import { langGraphSDKChannels } from "./langgraph-sdk-channels";

configureNode();

describe("LangGraph SDK instrumentation", () => {
  let backgroundLogger: ReturnType<
    typeof _exportsForTestingOnly.useTestBackgroundLogger
  >;
  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });
  beforeEach(() => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    initLogger({
      projectName: "tmp-luca-langgraph-sdk-test",
      projectId: "test-project-id",
    });
  });
  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  it("preserves promise identity and helpers", async () => {
    const promise = Object.assign(Promise.resolve({ answer: "yes" }), {
      helper: () => "helper",
    });
    const result = langGraphSDKChannels.wait.invoke(
      () => promise,
      undefined,
      [null, "agent", { input: "question" }],
      {},
    );
    expect(result).toBe(promise);
    expect(result.helper()).toBe("helper");
    await result;
    expect(await backgroundLogger.drain()).toMatchObject([
      { input: "question", output: { answer: "yes" } },
    ]);
  });

  it("preserves synchronous exceptions and rejected error identity", async () => {
    const error = new Error("original failure");
    expect(() =>
      langGraphSDKChannels.wait.invoke(
        () => {
          throw error;
        },
        undefined,
        [null, "agent"],
        {},
      ),
    ).toThrow(error);
    await expect(
      langGraphSDKChannels.wait.invoke(
        () => Promise.reject(error),
        undefined,
        [null, "agent"],
        {},
      ),
    ).rejects.toBe(error);
    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(2);
    for (const span of spans)
      expect(span).toMatchObject({
        error: expect.stringContaining("original failure"),
        metrics: { end: expect.any(Number) },
      });
  });

  it("contains extraction failures without calling the provider twice", async () => {
    let calls = 0;
    const options = {
      get input(): unknown {
        throw new Error("hostile getter");
      },
    };
    const result = langGraphSDKChannels.wait.invoke(
      async () => {
        calls++;
        return "result";
      },
      undefined,
      [null, "agent", options],
      {},
    );
    await expect(result).resolves.toBe("result");
    expect(calls).toBe(1);
  });

  it("retains partial output and ends a stream when its iterator rejects", async () => {
    const error = new Error("connection lost");
    const original = (async function* () {
      yield { event: "values", data: { answer: "partial" } };
      throw error;
    })();
    const result = langGraphSDKChannels.stream.invoke(
      () => original,
      undefined,
      [null, "agent"],
      {},
    );
    expect(result).toBe(original);
    await result.next();
    await expect(result.next()).rejects.toBe(error);
    expect(await backgroundLogger.drain()).toMatchObject([
      {
        output: { answer: "partial" },
        error: expect.stringContaining("connection lost"),
        metrics: { end: expect.any(Number) },
      },
    ]);
  });

  it("does not interpret acknowledgements or empty message deltas as tokens", async () => {
    const stream = langGraphSDKChannels.stream.invoke(
      async function* () {
        yield { event: "metadata", data: { run_id: "run" } };
        yield { event: "messages", data: [{ content: "", id: "message" }, {}] };
      },
      undefined,
      [null, "agent"],
      {},
    );
    for await (const _ of stream) {
      /* drain */
    }
    const [span] = await backgroundLogger.drain();
    expect(span).not.toHaveProperty("metrics.time_to_first_token");
  });

  it("captures reported usage without counting messages from previous turns", async () => {
    const previous = {
      id: "previous",
      type: "ai",
      content: "earlier",
      usage_metadata: {
        input_tokens: 100,
        output_tokens: 100,
        total_tokens: 200,
      },
    };
    const answer = {
      id: "answer",
      type: "ai",
      content: "new",
      usage_metadata: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    };
    await langGraphSDKChannels.wait.invoke(
      async () => ({ messages: [previous, answer] }),
      undefined,
      [null, "agent", { input: { messages: [previous] } }],
      {},
    );
    expect(await backgroundLogger.drain()).toMatchObject([
      { metrics: { prompt_tokens: 3, completion_tokens: 2, tokens: 5 } },
    ]);
  });

  it("preserves a null streamed graph value", async () => {
    const stream = langGraphSDKChannels.stream.invoke(
      async function* () {
        yield { event: "values", data: null };
      },
      undefined,
      [null, "agent"],
      {},
    );
    for await (const _ of stream) {
      /* drain */
    }
    expect(await backgroundLogger.drain()).toMatchObject([{ output: null }]);
  });

  it("leaves unsupported wrapper inputs untouched", () => {
    for (const value of [null, undefined, {}, { runs: {} }])
      expect(wrapLangGraphSDK(value)).toBe(value);
  });
});
