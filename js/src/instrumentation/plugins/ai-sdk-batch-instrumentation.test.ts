import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  exportAISDKBatchTrace,
  resumeAISDKBatchTrace,
} from "../../ai-sdk-batch";
import {
  _exportsForTestingOnly,
  initLogger,
  startSpan,
  withCurrent,
} from "../../logger";
import { configureNode } from "../../node/config";
import type {
  AISDKBatchAPI,
  AISDKBatchItem,
  AISDKBatchStatus,
  AISDKStartBatchOptions,
} from "../../vendor-sdk-types/ai-sdk-batch";
import { wrapAISDK } from "../../wrappers/ai-sdk";
import { aiSDKBatchChannels } from "./ai-sdk-batch-interceptors";
import { AISDKPlugin } from "./ai-sdk-plugin";
import { registry } from "../registry";

configureNode();

const params: AISDKStartBatchOptions = {
  requests: [
    { id: "one", type: "text", model: "test/model", prompt: "Hello" },
    {
      id: "two",
      type: "text",
      model: "test/model",
      messages: [{ role: "user", content: "World" }],
    },
  ],
  headers: { authorization: "transport-secret" },
  webhookUrl: "https://example.test/hook?token=webhook-secret",
  providerOptions: { gateway: { byok: "provider-secret" } },
};
const items: AISDKBatchItem[] = [
  {
    id: "two",
    type: "text",
    status: "succeeded",
    text: "World!",
    content: [{ type: "text", text: "World!" }],
    finishReason: "stop",
    usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
  },
  {
    id: "one",
    type: "text",
    status: "failed",
    error: { message: "Request rejected" },
  },
];
type TestRow = {
  id: string;
  span_id: string;
  root_span_id: string;
  span_parents: string[];
  span_attributes?: { name: string };
  metadata: Record<string, unknown>;
  metrics: Record<string, number>;
  error?: string;
};
let sequence = 0;

function client(results = items) {
  const batch = {
    version: 2 as const,
    id: `batch-${sequence++}`,
    provider: "gateway",
    status: "pending" as const,
  };
  let lastStream: ReturnType<AISDKBatchAPI["experimental_getBatchResults"]>;
  const status: AISDKBatchStatus = {
    status: "completed",
    requestCounts: { total: 2, completed: 1, failed: 1, pending: 0 },
  };
  const sdk: AISDKBatchAPI = {
    experimental_startBatch: vi.fn(async () => ({
      ...batch,
      providerMetadata: {
        gateway: { asyncJob: { webhookSigningSecret: "signing-secret" } },
      },
    })),
    experimental_getBatchStatus: vi.fn(async () => status),
    experimental_cancelBatch: vi.fn(async () => ({
      providerMetadata: { secret: "cancel-secret" },
    })),
    experimental_getBatchResults: vi.fn(() => {
      lastStream = new ReadableStream<AISDKBatchItem>({
        start(controller) {
          results.forEach((item) => controller.enqueue(item));
          controller.close();
        },
      }) as ReturnType<AISDKBatchAPI["experimental_getBatchResults"]>;
      return lastStream;
    }),
  };
  return {
    sdk,
    batch,
    status,
    stream: () => lastStream,
    wrapped: wrapAISDK(sdk),
  };
}

describe("AI SDK batch instrumentation", () => {
  let background: ReturnType<
    typeof _exportsForTestingOnly.useTestBackgroundLogger
  >;
  let plugin: AISDKPlugin;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });
  beforeEach(() => {
    background = _exportsForTestingOnly.useTestBackgroundLogger();
    initLogger({
      projectName: "ai-sdk-batch.test",
      projectId: "test-project-id",
    });
    registry.disable();
    plugin = new AISDKPlugin();
    plugin.enable();
  });
  afterEach(() => {
    plugin.disable();
    vi.unstubAllEnvs();
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  it("traces unordered results under the submitting parent without retaining secrets", async () => {
    const { sdk, wrapped } = client();
    const parent = startSpan({ name: "submitter" });
    const batch = await withCurrent(parent, () =>
      wrapped.experimental_startBatch(params),
    );
    expect(sdk.experimental_startBatch).toHaveBeenCalledExactlyOnceWith(params);
    expect(batch).toHaveProperty(
      "providerMetadata.gateway.asyncJob.webhookSigningSecret",
      "signing-secret",
    );
    const context = await exportAISDKBatchTrace(batch);
    expect(context).toBeTypeOf("string");
    expect(context).not.toContain("Hello");
    expect(context).not.toContain("World");
    await wrapped.experimental_getBatchStatus({ batch });
    const received = [];
    for await (const item of wrapped.experimental_getBatchResults({ batch }))
      received.push(item);
    expect(received).toEqual(items);
    parent.end();
    const rows = (await background.drain()) as TestRow[];
    const task = rows.find((row) => row.span_attributes?.name === "ai.batch")!;
    const children = rows.filter(
      (row) => row.span_attributes?.name === "ai.batch.request",
    );
    expect(task.span_parents).toEqual([parent.spanId]);
    expect(task.metadata).toMatchObject({
      status: "completed",
      request_counts: { total: 2 },
    });
    expect(children).toHaveLength(2);
    expect(children.every((row) => row.span_parents[0] === task.span_id)).toBe(
      true,
    );
    expect(
      children.find((row) => row.metadata.request_id === "two"),
    ).toMatchObject({
      output: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "World!" }],
          },
        },
      ],
      metrics: {
        prompt_tokens: 5,
        completion_tokens: 2,
        tokens: 7,
        end: expect.any(Number),
      },
    });
    expect(
      children.find((row) => row.metadata.request_id === "one")?.error,
    ).toContain("Request rejected");
    for (const secret of [
      "transport-secret",
      "webhook-secret",
      "provider-secret",
      "signing-secret",
    ]) {
      expect(JSON.stringify(rows)).not.toContain(secret);
      expect(context).not.toContain(secret);
    }
    expect(await exportAISDKBatchTrace(batch)).toBeUndefined();
  });

  it.each(["iterator", "reader", "pipe", "transform", "tee"] as const)(
    "preserves stream identity and records results through %s",
    async (mode) => {
      const { wrapped, stream } = client();
      const batch = await wrapped.experimental_startBatch(params);
      const result = wrapped.experimental_getBatchResults({ batch });
      expect(result).toBe(stream());
      const received: AISDKBatchItem[] = [];
      if (mode === "reader") {
        const reader = result.getReader();
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          received.push(item.value);
        }
        reader.releaseLock();
      } else if (mode === "pipe") {
        await result.pipeTo(
          new WritableStream({
            write(item) {
              received.push(item);
            },
          }),
        );
      } else if (mode === "transform") {
        const transformed = result.pipeThrough(
          new TransformStream<AISDKBatchItem, AISDKBatchItem>(),
        );
        await transformed.pipeTo(
          new WritableStream({
            write(item) {
              received.push(item);
            },
          }),
        );
      } else if (mode === "tee") {
        const [left, right] = result.tee();
        await Promise.all([
          left.pipeTo(
            new WritableStream({
              write(item) {
                received.push(item);
              },
            }),
          ),
          right.pipeTo(new WritableStream()),
        ]);
      } else {
        for await (const item of result) received.push(item);
      }
      expect(received).toEqual(items);
      const rows = (await background.drain()) as TestRow[];
      expect(
        rows.filter((row) => row.span_attributes?.name === "ai.batch.request"),
      ).toHaveLength(2);
      expect(rows.every((row) => row.metrics.end !== undefined)).toBe(true);
    },
  );

  it("restores stable rows from serialized context after process-local tracking is lost", async () => {
    const { wrapped } = client();
    const batch = await wrapped.experimental_startBatch(params);
    const context = (await exportAISDKBatchTrace(batch))!;
    const initial = (await background.drain()) as TestRow[];
    // Simulate another SDK process without its in-memory spans.
    Reflect.get(
      globalThis,
      Symbol.for("braintrust.ai-sdk.batch-traces.v1"),
    ).clear();
    await resumeAISDKBatchTrace(context);
    await resumeAISDKBatchTrace(context);
    await wrapped.experimental_getBatchStatus({ batch });
    for await (const _item of wrapped.experimental_getBatchResults({ batch })) {
      /* consume */
    }
    const completed = (await background.drain()) as TestRow[];
    expect(completed.map((row) => row.id).sort()).toEqual(
      initial.map((row) => row.id).sort(),
    );
    expect(completed.map((row) => row.root_span_id)).toEqual(
      initial.map((row) => row.root_span_id),
    );
    expect(completed.every((row) => row.metrics.end !== undefined)).toBe(true);
  });

  it("keeps unconsumed requests pending and allows fetching results again", async () => {
    const { wrapped } = client();
    const batch = await wrapped.experimental_startBatch(params);
    for await (const _item of wrapped.experimental_getBatchResults({ batch }))
      break;
    const partial = (await background.drain()) as TestRow[];
    expect(
      partial.find((row) => row.span_attributes?.name === "ai.batch")?.metrics
        .end,
    ).toBeUndefined();
    expect(partial.filter((row) => row.metrics.end !== undefined)).toHaveLength(
      1,
    );
    for await (const _item of wrapped.experimental_getBatchResults({ batch })) {
      /* consume */
    }
    const completed = (await background.drain()) as TestRow[];
    expect(
      completed.filter((row) => row.metrics.end !== undefined),
    ).toHaveLength(2);
  });

  it("records cancellation requested without ending spans, then closes a failed batch", async () => {
    const { wrapped, status } = client([]);
    const batch = await wrapped.experimental_startBatch(params);
    await wrapped.experimental_cancelBatch({ batch });
    const pending = (await background.drain()) as TestRow[];
    expect(
      pending.find((row) => row.span_attributes?.name === "ai.batch")?.metadata
        .cancellation_requested,
    ).toBe(true);
    expect(pending.every((row) => row.metrics.end === undefined)).toBe(true);
    Object.assign(status, {
      status: "failed",
      error: { message: "Cancelled" },
    });
    await wrapped.experimental_getBatchStatus({ batch });
    for await (const _item of wrapped.experimental_getBatchResults({ batch })) {
      /* consume */
    }
    const ended = (await background.drain()) as TestRow[];
    expect(ended).toHaveLength(3);
    expect(
      ended.every((row) => row.error && row.metrics.end !== undefined),
    ).toBe(true);
  });

  it("does not complete a batch with missing or unknown results", async () => {
    const { wrapped } = client([items[0], { ...items[1], id: "unknown" }]);
    const batch = await wrapped.experimental_startBatch(params);
    for await (const _item of wrapped.experimental_getBatchResults({ batch })) {
      /* consume */
    }
    const rows = (await background.drain()) as TestRow[];
    expect(
      rows.find((row) => row.span_attributes?.name === "ai.batch")?.metrics.end,
    ).toBeUndefined();
    expect(await exportAISDKBatchTrace(batch)).toBeTypeOf("string");
  });

  it("propagates submission and stream errors without retrying or ending pending requests", async () => {
    const { sdk, wrapped } = client();
    const failure = new Error("Provider unavailable");
    vi.mocked(sdk.experimental_startBatch).mockRejectedValueOnce(failure);
    await expect(wrapped.experimental_startBatch(params)).rejects.toBe(failure);
    expect(sdk.experimental_startBatch).toHaveBeenCalledTimes(1);
    expect((await background.drain())[0]).toMatchObject({
      error: expect.stringContaining("Provider unavailable"),
      metrics: { end: expect.any(Number) },
    });
    const batch = await wrapped.experimental_startBatch(params);
    sdk.experimental_getBatchResults = () =>
      new ReadableStream({
        pull(controller) {
          controller.error(failure);
        },
      }) as ReturnType<AISDKBatchAPI["experimental_getBatchResults"]>;
    const result = wrapped.experimental_getBatchResults({ batch });
    await expect(result.getReader().read()).rejects.toBe(failure);
    const rows = (await background.drain()) as TestRow[];
    expect(rows.every((row) => row.metrics.end === undefined)).toBe(true);
  });

  it("deduplicates a manual wrapper around an auto-instrumented function", async () => {
    const { sdk } = client();
    const original = sdk.experimental_startBatch;
    sdk.experimental_startBatch = (options) =>
      aiSDKBatchChannels.startBatch.invoke(original, sdk, [options], {});
    await wrapAISDK(sdk).experimental_startBatch(params);
    expect(original).toHaveBeenCalledTimes(1);
    expect(await background.drain()).toHaveLength(3);
  });

  it("normalizes tools and messages while keeping request settings out of input", async () => {
    const result: AISDKBatchItem = {
      id: "one",
      type: "text",
      status: "succeeded",
      finishReason: "tool-calls",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "weather",
          input: { city: "Paris" },
        },
      ],
      response: { modelId: "resolved-model" },
      usage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 },
    };
    const { wrapped } = client([result]);
    const execute = vi.fn();
    const batch = await wrapped.experimental_startBatch({
      requests: [
        {
          id: "one",
          type: "text",
          model: "test/model",
          instructions: "Use the tool",
          prompt: "Weather in Paris?",
          temperature: 0.1,
          maxOutputTokens: 20,
          tools: {
            weather: {
              description: "Weather lookup",
              inputSchema: { type: "object" },
              execute,
            },
          },
          toolChoice: { type: "tool", toolName: "weather" },
        },
      ],
    });
    for await (const _item of wrapped.experimental_getBatchResults({ batch })) {
      /* consume */
    }
    const rows = (await background.drain()) as TestRow[];
    expect(
      rows.find((row) => row.span_attributes?.name === "ai.batch.request"),
    ).toMatchObject({
      input: [
        { role: "system", content: "Use the tool" },
        { role: "user", content: "Weather in Paris?" },
      ],
      metadata: {
        model: "resolved-model",
        temperature: 0.1,
        max_tokens: 20,
        tools: [
          {
            type: "function",
            function: {
              name: "weather",
              description: "Weather lookup",
              parameters: { type: "object" },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "weather" } },
      },
      output: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "weather", arguments: '{"city":"Paris"}' },
              },
            ],
          },
        },
      ],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves remote images and omits inline bytes unless attachment capture is enabled", async () => {
    vi.stubEnv("BRAINTRUST_CAPTURE_ATTACHMENTS", "false");
    const { wrapped } = client();
    await wrapped.experimental_startBatch({
      requests: [
        {
          id: "one",
          type: "text",
          model: "test/model",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe the picture" },
                { type: "image", image: "https://example.test/picture.png" },
                {
                  type: "image",
                  image: "data:image/png;base64,aW5saW5lLXNlY3JldA==",
                },
              ],
            },
          ],
        },
      ],
    });
    const rows = await background.drain();
    expect(JSON.stringify(rows)).toContain("https://example.test/picture.png");
    expect(JSON.stringify(rows)).not.toContain("aW5saW5lLXNlY3JldA==");
  });

  it("does not duplicate spans on retrieval after completion", async () => {
    const { wrapped } = client();
    const batch = await wrapped.experimental_startBatch(params);
    for await (const _item of wrapped.experimental_getBatchResults({ batch })) {
      /* consume */
    }
    await background.drain();
    for await (const _item of wrapped.experimental_getBatchResults({ batch })) {
      /* consume */
    }
    expect(await background.drain()).toHaveLength(0);
  });

  it("forwards an abort signal while leaving the batch retryable", async () => {
    const { sdk, wrapped } = client();
    const batch = await wrapped.experimental_startBatch(params);
    const controller = new AbortController();
    const reason = new Error("Aborted by application");
    sdk.experimental_getBatchResults = (options) => {
      expect(options.abortSignal).toBe(controller.signal);
      return new ReadableStream<AISDKBatchItem>({
        start(stream) {
          options.abortSignal?.addEventListener("abort", () =>
            stream.error(options.abortSignal?.reason),
          );
        },
      }) as ReturnType<AISDKBatchAPI["experimental_getBatchResults"]>;
    };
    const stream = wrapped.experimental_getBatchResults({
      batch,
      abortSignal: controller.signal,
    });
    const read = stream.getReader().read();
    controller.abort(reason);
    await expect(read).rejects.toBe(reason);
    expect(await exportAISDKBatchTrace(batch)).toBeTypeOf("string");
    const rows = (await background.drain()) as TestRow[];
    expect(rows.every((row) => row.metrics.end === undefined)).toBe(true);
  });

  it("passes through without instrumentation and ignores invalid contexts", async () => {
    await resumeAISDKBatchTrace("invalid");
    await resumeAISDKBatchTrace(
      JSON.stringify({ version: 99, secret: "never log this" }),
    );
    expect(await background.drain()).toHaveLength(0);
    plugin.disable();
    const { sdk, wrapped } = client();
    const batch = await wrapped.experimental_startBatch(params);
    expect(sdk.experimental_startBatch).toHaveBeenCalledTimes(1);
    expect(await exportAISDKBatchTrace(batch)).toBeUndefined();
    expect(await background.drain()).toHaveLength(0);
  });
});
