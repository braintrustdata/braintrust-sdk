/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import { afterEach, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { configureNode } from "../../node/config";
configureNode();
import { LiveKitSpanProcessor } from "./processor";
import * as audioOptions from "./node/audio-options";
import * as audioExtension from "../../audio/index";
import * as audioWorker from "../../audio/worker";
import { encodeCall } from "../../audio/pcm";
import { Attachment } from "../../logger";
import { channel, defineInterceptor } from "../core/interceptor-definitions";
import { traceAsyncCall } from "../core/tracing";
let processor: LiveKitSpanProcessor | undefined;
afterEach(async () => {
  await processor?.shutdown();
  processor = undefined;
});
function fixture(
  captureContent = false,
  options: Partial<ConstructorParameters<typeof LiveKitSpanProcessor>[0]> = {},
) {
  const rows: {
    args: any;
    parent?: string;
    logs: any[];
    end: any;
    spanId: string;
  }[] = [];
  function owner(parent?: string): any {
    return {
      flush: async () => {},
      startSpan(args: any) {
        const row = {
          args,
          parent,
          logs: [] as any[],
          end: undefined as any,
          spanId: (rows.length + 1).toString(16).padStart(16, "0"),
        };
        rows.push(row);
        return {
          ...owner(row.spanId),
          spanId: row.spanId,
          rootSpanId: "1234567890abcdef1234567890abcdef",
          log(event: any) {
            row.logs.push(event);
          },
          end(event: { endTime?: number } = {}) {
            row.end ??= { endTime: event.endTime ?? Date.now() / 1000 };
            return row.end.endTime;
          },
        };
      },
    };
  }
  processor = new LiveKitSpanProcessor({
    logger: owner(),
    captureContent,
    captureUserAudio: false,
    captureAgentAudio: false,
    ...options,
  });
  const span = (
    id: string,
    name: string,
    parent?: string,
    attributes: any = {},
  ) => ({
    name,
    spanContext: () => ({ spanId: id, traceId: "trace" }),
    parentSpanContext: parent ? { spanId: parent } : undefined,
    startTime: [1, 0] as [number, number],
    endTime: [2, 0] as [number, number],
    attributes,
    events: [],
    status: { code: 0 },
  });
  return { rows, span, p: processor };
}
test("native hierarchy and inference types survive; namespace and tool payloads are normalized", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session"),
    turn = span("t", "agent_turn", "s"),
    model = span("m", "realtime_inference", "t"),
    tool = span("f", "function_tool", "t", {
      "lk.function_tool.name": "lookup_order",
      "gen_ai.tool.call.id": "call-1",
      "lk.pii.function_tool.arguments": '{"id":1}',
      "lk.pii.function_tool.output": '{"ok":true}',
    });
  for (const s of [root, turn, model, tool]) p.onStart(s);
  for (const s of [model, tool, turn, root]) p.onEnd(s);
  expect(rows.map((r) => r.parent)).toEqual([
    undefined,
    rows[0].spanId,
    rows[1].spanId,
    rows[1].spanId,
  ]);
  expect(rows[2].args.type).toBe("llm");
  expect(
    rows[3].logs.some((e: any) => e.span_attributes?.name === "lookup_order"),
  ).toBe(true);
  expect(rows[3].logs.find((e: any) => e.input)?.input).toEqual({ id: 1 });
  expect(rows.every((r) => r.end.endTime === 2)).toBe(true);
});
test("content opt-out retains timing and IDs without logging transcript or tool content", () => {
  const { rows, span, p } = fixture(false),
    root = span("s", "agent_session"),
    turn = span("t", "agent_turn", "s", {
      "lk.pii.user_input": "secret",
      "lk.speech_id": "speech",
      "gen_ai.input.messages": "secret",
    });
  p.onStart(root);
  p.onStart(turn);
  p.onEnd(turn);
  p.onEnd(root);
  expect(JSON.stringify(rows)).not.toContain("secret");
  expect(JSON.stringify(rows)).toContain("livekit.speech_id");
});
test("concurrent sessions keep parents separate; closing one does not clear another", () => {
  const { rows, span, p } = fixture(),
    a = span("a", "agent_session"),
    b = span("b", "agent_session"),
    child = span("t", "agent_turn", "a");
  p.onStart(a);
  p.onStart(b);
  p.onStart(child);
  p.onEnd(a);
  expect(rows[2].parent).toBe(rows[0].spanId);
  const laterChild = span("later", "agent_turn", "b");
  p.onStart(laterChild);
  p.onEnd(laterChild);
  p.onEnd(child);
  p.onEnd(b);
  expect(rows[3].parent).toBe(rows[1].spanId);
  expect(rows[3].end).toEqual({ endTime: 2 });
  expect(rows[1].end).toEqual({ endTime: 2 });
});
test("late tool completion keeps its native owner after the session ends", () => {
  const { rows, span, p } = fixture(true);
  const root = span("root", "agent_session"),
    turn = span("turn", "agent_turn", "root"),
    tool = span("tool", "function_tool", "turn", {
      "gen_ai.tool.name": "late_tool",
      "gen_ai.tool.call.result": '{"ok":true}',
    });
  for (const s of [root, turn, tool]) p.onStart(s);
  p.onEnd(turn);
  p.onEnd(root);
  expect(rows[2].end).toBeUndefined();
  p.onEnd(tool);
  expect(rows[2].logs.find((event: any) => event.output)?.output).toEqual({
    ok: true,
  });
  expect(rows[2].parent).toBe(rows[1].spanId);
});
test("committed messages retain identity and honor content opt-out", () => {
  const { rows, span, p } = fixture(false),
    root = span("root", "agent_session");
  p.onStart(root);
  p.conversation(
    { sessionSpan: root },
    { type: "message", id: "item", role: "user", textContent: "private" },
  );
  p.onEnd(root);
  expect(JSON.stringify(rows)).not.toContain("private");
});
test("inference suppression preserves results and leaves provider calls in user tools visible", async () => {
  const { rows, span, p } = fixture(true);
  const root = span("root", "agent_session");
  const turn = span("turn", "agent_turn", "root");
  p.onStart(root);
  p.onStart(turn);
  const channels = defineInterceptor("livekit-test-provider", {
    request: channel<[], Promise<string>>({ channelName: "request" }),
  });
  const unsubscribe = channels.request.intercept((target, self, args) =>
    traceAsyncCall<typeof channels.request>(
      () => Reflect.apply(target, self, args),
      { arguments: args },
      {
        instrumentationName: "openai",
        name: "provider-request",
        type: "llm",
        extractInput: () => ({ input: "request", metadata: undefined }),
        extractOutput: (value) => value,
        extractMetrics: () => ({}),
      },
    ),
  );
  try {
    const request = () =>
      channels.request.invoke(async () => "answer", undefined, [], {});
    await p.scope(turn, async () => {
      expect(
        await p.inference(async () => {
          await Promise.resolve();
          return request();
        }),
      ).toBe("answer");
      expect(await request()).toBe("answer"); // e.g. a provider call inside a user tool
    });
    expect(
      rows.filter((row) => row.args.name === "provider-request"),
    ).toHaveLength(1);
  } finally {
    unsubscribe();
  }
  p.onEnd(turn);
  p.onEnd(root);
});

test("common voice operations expose standard messages, metrics, and native provenance", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session");
  const user = span("u", "user_turn", "s", {
    "lk.pii.user_transcript": "Where is order 1042?",
  });
  const turn = span("a", "agent_turn", "s");
  const model = span("m", "llm_node", "a", {
    "gen_ai.request.model": "gpt-4.1-nano",
    "gen_ai.provider.name": "openai",
    "gen_ai.usage.input_tokens": 10,
    "gen_ai.usage.output_tokens": 3,
    "lk.response.ttft": 0.2,
    "gen_ai.output.messages": JSON.stringify([
      {
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "call-1",
            name: "lookup_order",
            arguments: { order_id: "1042" },
          },
        ],
      },
    ]),
  });
  for (const s of [root, user, turn, model]) p.onStart(s);
  for (const s of [model, user, turn, root]) p.onEnd(s);
  expect(rows.map((r) => r.args.name)).toEqual([
    "livekit.agent_session",
    "user_turn",
    "agent_turn",
    "llm_response",
  ]);
  expect(rows[1].logs.some((e) => e.input)).toBe(false);
  expect(
    rows[3].logs.some(
      (e) => e.metrics?.tokens === 13 && e.metrics?.time_to_first_token === 0.2,
    ),
  ).toBe(true);
  expect(rows[3].logs.some((e) => e.metadata?.model === "gpt-4.1-nano")).toBe(
    true,
  );
  expect(
    rows[3].logs.some((e) => e.output?.[0]?.tool_calls?.[0]?.id === "call-1"),
  ).toBe(true);
  expect(
    rows[3].logs.some((e) => e.metadata?.["turn.id"] === rows[2].spanId),
  ).toBe(true);
});
test("content opt-out also excludes system instructions and tool definitions", () => {
  const { rows, span, p } = fixture(false);
  const root = span("s", "agent_session");
  const model = span("m", "llm_node", "s", {
    "gen_ai.system_instructions": "private instructions",
    "gen_ai.tool.definitions": "private definitions",
  });
  p.onStart(root);
  p.onStart(model);
  p.onEnd(model);
  p.onEnd(root);
  expect(JSON.stringify(rows)).not.toContain("private");
});

test("tool-only responses retain tool requests on the model without inventing speech", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session"),
    turn = span("a", "agent_turn", "s"),
    model = span("m", "llm_node", "a", {
      "gen_ai.output.messages": JSON.stringify([
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              id: "call-1",
              name: "lookup_order",
              arguments: { order_id: "1042" },
            },
          ],
        },
      ]),
    });
  for (const s of [root, turn, model]) p.onStart(s);
  for (const s of [model, turn, root]) p.onEnd(s);
  expect(
    rows[2].logs.some((e) => e.output?.[0]?.tool_calls?.[0]?.id === "call-1"),
  ).toBe(true);
});

test("upload failure corrects recording descriptors and selections even when logger flush resolves", async () => {
  // Exporter-level tests cover rejection/status propagation; this checks wiring.
  // Exercise real encoding/export without requiring a built worker in core tests.
  const encoder = vi
    .spyOn(audioWorker, "createEncoder")
    .mockReturnValue(async (packets, durationMs) => ({
      ...encodeCall(packets, durationMs),
      mimeType: "audio/wav",
      sampleRate: 24000,
    }));
  const resolve = audioOptions.resolveAudioOptions;
  const load = vi
    .spyOn(audioOptions, "resolveAudioOptions")
    .mockImplementation((options) => resolve(options, () => audioExtension));
  const upload = vi.spyOn(Attachment.prototype, "upload").mockResolvedValue({
    upload_status: "error",
    error_message: "upload unavailable",
  });
  try {
    const { p, rows, span } = fixture(false, { captureUserAudio: true });
    const root = span("session", "agent_session"),
      turn = span("user", "user_turn", "session");
    p.onStart(root);
    p.onStart(turn);
    const session = { sessionSpan: root },
      activity = { agentSession: session };
    p.begin(session);
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({
          data: new Int16Array(480).fill(1234),
          sampleRate: 24000,
          channels: 1,
        });
        controller.close();
      },
    });
    p.input(activity, source);
    const reader = source.getReader();
    await reader.read();
    reader.releaseLock();
    p.userTurn(activity, {
      userTurnSpan: turn,
      startedSpeakingAt: Date.now() - 1000,
      stoppedSpeakingAt: Date.now() + 1000,
    });
    p.onEnd(turn);
    p.onEnd(root);
    await p.forceFlush();
    const descriptors = rows[0].logs
      .filter((event) => event.metadata?.["audio.recordings"])
      .at(-1).metadata["audio.recordings"];
    expect(descriptors).toContainEqual(
      expect.objectContaining({
        id: "call-0000",
        state: "omitted",
        reason: "recording_export_failed",
      }),
    );
    expect(
      rows[1].logs
        .filter((event) => event.metadata?.["audio.selections"])
        .at(-1).metadata["audio.selections"],
    ).toEqual([]);
    expect(upload).toHaveBeenCalledTimes(1);
  } finally {
    upload.mockRestore();
    load.mockRestore();
    encoder.mockRestore();
  }
});

test("failed shutdown flush still releases the runtime for another processor", async () => {
  const failure = new Error("export unavailable");
  fixture(false, {
    logger: {
      flush: async () => {
        throw failure;
      },
    } as any,
  });
  const failed = processor!;
  processor = undefined;
  await expect(failed.shutdown()).rejects.toBe(failure);
  expect(() => fixture()).not.toThrow();
});

test("duplex generation content comes from LiveKit streams without provider events", async () => {
  const { rows, span, p } = fixture(true);
  const root = span("root", "agent_session");
  const turn = span("turn", "agent_turn", "root");
  const inference = span("model", "realtime_inference", "turn");
  for (const native of [root, turn, inference]) p.onStart(native);
  const session = Object.assign(new EventEmitter(), {
    chatCtx: {
      items: [
        {
          type: "message",
          id: "user",
          role: "user",
          content: ["Where is order 1042?"],
        },
      ],
    },
  });
  const stream = <T>(items: T[]) =>
    new ReadableStream<T>({
      start(c) {
        for (const item of items) c.enqueue(item);
        c.close();
      },
    });
  const textStream = stream(["It arrives ", "Friday."]);
  const ev = {
    responseId: "native-response",
    messageStream: stream([{ messageId: "answer", textStream }]),
    functionStream: stream([
      {
        type: "function_call",
        callId: "call",
        name: "lookup_order",
        args: '{"order_id":"1042"}',
      },
    ]),
  };
  p.realtime(
    { agentSession: { sessionSpan: root }, realtimeSession: session },
    { ev, inferenceSpan: inference, span: turn },
  );
  expect(textStream.locked).toBe(false);
  const consumed: string[] = [];
  await ev.messageStream.pipeTo(
    new WritableStream({
      async write(message) {
        await message.textStream.pipeTo(
          new WritableStream({
            write(text) {
              consumed.push(text);
            },
          }),
        );
      },
    }),
  );
  expect(consumed).toEqual(["It arrives ", "Friday."]);
  await ev.functionStream.pipeTo(new WritableStream());
  p.onEnd(inference);
  expect(rows[2].logs).toContainEqual(
    expect.objectContaining({
      input: [{ role: "user", content: "Where is order 1042?" }],
    }),
  );
  expect(rows[2].logs).toContainEqual({
    output: [{ role: "assistant", content: "It arrives Friday." }],
  });
  expect(
    rows[2].logs.some((e: any) =>
      e.output?.some((m: any) => m.tool_calls?.[0]?.id === "call"),
    ),
  ).toBe(true);
  p.onEnd(turn);
  p.onEnd(root);
});

test("installing a realtime observer never hides a native caller turn", () => {
  const { rows, span, p } = fixture();
  const root = span("root", "agent_session");
  p.onStart(root);
  p.realtime({
    agentSession: { sessionSpan: root },
    realtimeSession: new EventEmitter(),
  });
  const user = span("user", "user_turn", "root");
  p.onStart(user);
  p.onEnd(user);
  expect(rows[1].args.name).toBe("user_turn");
  expect(JSON.stringify(rows[1])).not.toContain("input_observation");
  p.onEnd(root);
});

test("late native realtime metrics update their model operation without another span", () => {
  const { rows, span, p } = fixture();
  const root = span("s", "agent_session");
  const model = span("m", "realtime_inference", "s");
  const late = span("late", "realtime_metrics", "m", {
    "gen_ai.response.id": "response-1",
    "gen_ai.usage.input_tokens": 10,
    "gen_ai.usage.output_tokens": 3,
  });
  p.onStart(root);
  p.onStart(model);
  p.onEnd(model);
  p.onStart(late);
  p.onEnd(late);
  expect(rows).toHaveLength(2);
  expect(rows[1].logs).toContainEqual(
    expect.objectContaining({
      metrics: expect.objectContaining({
        prompt_tokens: 10,
        completion_tokens: 3,
        tokens: 13,
      }),
      metadata: expect.objectContaining({ "gen_ai.response.id": "response-1" }),
    }),
  );
});

test("early native realtime usage reaches its inference with content capture disabled", () => {
  const { rows, span, p } = fixture(false);
  const root = span("root", "agent_session");
  const session = { sessionSpan: root } as any;
  const realtimeSession = new EventEmitter();
  const activity = { agentSession: session, realtimeSession } as any;
  p.onStart(root);
  p.realtime(activity);
  realtimeSession.emit("metrics_collected", {
    type: "realtime_model_metrics",
    requestId: "response",
    inputTokens: 10,
    outputTokens: 2,
    transcript: "must not be logged",
  });
  const inference = span("model", "realtime_inference", "root");
  p.onStart(inference);
  p.realtime(activity, {
    inferenceSpan: inference,
    ev: { responseId: "response" },
  } as any);
  p.onEnd(inference);
  expect(rows[1].logs).toContainEqual(
    expect.objectContaining({
      metrics: { prompt_tokens: 10, completion_tokens: 2, tokens: 12 },
    }),
  );
  expect(JSON.stringify(rows)).not.toContain("must not be logged");
  p.onEnd(root);
});

test("native speech preserves overlap, segmentation, late transcript timing and session ownership", () => {
  const { rows, span, p } = fixture(true);
  const root = span("root", "agent_session");
  const agent = span("agent", "agent_speaking", "root");
  const caller = span("caller", "user_speaking", "root");
  agent.endTime = [6, 0];
  caller.startTime = [3, 0];
  caller.endTime = [4, 0];
  for (const native of [root, agent, caller]) p.onStart(native);
  p.onEnd(caller);
  p.conversation(
    { sessionSpan: root },
    {
      type: "message",
      id: "late",
      role: "user",
      textContent: "Wait, order 1042",
      metrics: { startedSpeakingAt: 3 },
    },
  );
  p.conversation(
    { sessionSpan: root },
    {
      type: "message",
      id: "agent-message",
      role: "assistant",
      textContent: "It arrives Friday.",
      metrics: { startedSpeakingAt: 1 },
    },
  );
  p.onEnd(agent);
  expect(rows.map((r) => r.args.name)).toEqual([
    "livekit.agent_session",
    "agent_speech",
    "user_speech",
  ]);
  expect(rows[1].end.endTime).toBe(6);
  expect(rows[2].args.startTime).toBe(3);
  expect(rows[2].end.endTime).toBe(4);
  expect(rows[2].logs).toContainEqual({
    input: [{ role: "user", content: "Wait, order 1042" }],
  });
  expect(rows[1].logs).toContainEqual({
    output: [{ role: "assistant", content: "It arrives Friday." }],
  });
  expect(rows[2].parent).toBe(rows[0].spanId);
});

test("native user fragments remain speech segments instead of pause-grouped turns", () => {
  const { rows, span, p } = fixture(true);
  const root = span("root", "agent_session");
  p.onStart(root);
  const provider = new EventEmitter();
  p.realtime({
    agentSession: { sessionSpan: root },
    realtimeSession: provider,
  });
  for (const [id, text] of [
    ["a", "Where is my order"],
    ["b", "1042?"],
  ]) {
    const speech = span(id, "user_speaking", "root");
    p.onStart(speech);
    provider.emit("input_audio_transcription_completed", {
      itemId: id,
      transcript: text,
      isFinal: true,
    });
    p.onEnd(speech);
  }
  expect(rows.map((row) => row.args.name)).toEqual([
    "livekit.agent_session",
    "user_speech",
    "user_speech",
  ]);
  expect(
    rows
      .slice(1)
      .map((r) => r.logs.filter((log) => log.input).at(-1).input[0].content),
  ).toEqual(["Where is my order", "1042?"]);
});

test("tool request, continuation, input speech and generated speech use exported link identities", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session");
  const turn = span("turn", "agent_turn", "s");
  const user = span("u", "user_speaking", "s");
  const model = span("m", "llm_node", "turn", {
    "lk.pii.chat_ctx": {
      items: [
        { type: "message", id: "caller", role: "user", content: ["Order?"] },
      ],
    },
    "lk.pii.response.function_calls": [
      { call_id: "call", name: "lookup_order" },
    ],
  });
  const tool = span("tool", "function_tool", "turn", {
    "gen_ai.tool.call.id": "call",
  });
  const continuation = span("next", "llm_node", "turn", {
    "lk.pii.chat_ctx": {
      items: [
        { type: "function_call_output", call_id: "call", output: "Friday" },
      ],
    },
  });
  for (const native of [root, turn, user, model, tool]) p.onStart(native);
  // Late request/transcript resolution also works after the consuming operation ended.
  p.onEnd(tool);
  p.onEnd(model);
  p.onEnd(user);
  p.conversation(
    { sessionSpan: root },
    {
      type: "message",
      id: "caller",
      role: "user",
      textContent: "Order?",
      metrics: { startedSpeakingAt: 1 },
    },
  );
  p.scope(turn, () => {
    p.inference(() => {
      p.onStart(continuation);
      return [null, { id: "answer" }];
    });
    const tts = span("tts", "tts_node", "turn");
    const speech = span("speech", "agent_speaking", "turn");
    p.onStart(tts);
    p.onStart(speech);
    p.conversation(
      { sessionSpan: root },
      {
        type: "message",
        id: "answer",
        role: "assistant",
        textContent: "Friday",
      },
    );
    p.onEnd(speech);
    p.onEnd(tts);
  });
  p.onEnd(continuation);
  const links = (i: number) =>
    rows[i].logs.filter((log) => log.metadata?.links).at(-1)?.metadata?.links ??
    [];
  const link = (target: number, type: string) => ({
    context: {
      traceId: "1234567890abcdef1234567890abcdef",
      spanId: rows[target].spanId,
      traceFlags: 1,
    },
    attributes: { "braintrust.relationship.type": type },
  });
  expect(
    rows.flatMap((row) => row.logs).every((log) => !("links" in log)),
  ).toBe(true);
  expect(links(3)).toEqual([link(2, "input_context")]);
  expect(links(4)).toEqual([link(3, "requested_by")]);
  expect(links(5)).toEqual([link(4, "consumes_tool_result")]);
  expect(links(6)).toEqual([link(5, "generated_by")]);
  expect(links(7)).toEqual([link(5, "generated_by")]);
  expect(JSON.stringify(rows)).not.toContain("continuation.tool_call_ids");
  expect(JSON.stringify(rows)).not.toContain("request_span_id");
});

test.each([undefined, "Heard prefix"])(
  "interrupted speech uses only synchronized playback text (%s)",
  (synchronizedTranscript) => {
    const { rows, span, p } = fixture(true);
    const root = span("s", "agent_session"),
      speech = span("a", "agent_speaking", "s");
    p.onStart(root);
    p.onStart(speech);
    const sink = Object.assign(new EventEmitter(), {
      captureFrame: async () => {},
      flush() {},
      clearBuffer() {},
    });
    const session: any = {
      sessionSpan: root,
      agentSpeakingSpan: speech,
      output: { audio: sink },
    };
    p.output(session);
    sink.emit("playbackFinished", {
      interrupted: true,
      synchronizedTranscript,
    });
    p.conversation(session, {
      type: "message",
      id: "answer",
      role: "assistant",
      textContent: "Heard prefix and unheard suffix",
      interrupted: true,
    });
    expect(rows[1].logs.filter((log) => log.output)).toEqual(
      synchronizedTranscript === undefined
        ? []
        : [
            {
              output: [{ role: "assistant", content: synchronizedTranscript }],
            },
          ],
    );
  },
);

test("an untimed final transcript resolves only an unambiguous native speech interval", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session"),
    first = span("first", "user_speaking", "s");
  p.onStart(root);
  const provider = new EventEmitter();
  p.realtime({
    agentSession: { sessionSpan: root },
    realtimeSession: provider,
  });
  p.onStart(first);
  p.onEnd(first);
  provider.emit("input_audio_transcription_completed", {
    itemId: "first-text",
    transcript: "Order 1042",
    isFinal: true,
  });
  expect(rows[1].logs).toContainEqual({
    input: [{ role: "user", content: "Order 1042" }],
  });
  const second = span("second", "user_speaking", "s"),
    third = span("third", "user_speaking", "s");
  p.onStart(second);
  p.onEnd(second);
  p.onStart(third);
  provider.emit("input_audio_transcription_completed", {
    itemId: "ambiguous",
    transcript: "Unattributed",
    isFinal: true,
  });
  expect(rows.slice(2).some((row) => row.logs.some((log) => log.input))).toBe(
    false,
  );
});

test("synchronous realtime speech dispatch supplies identity even when native start follows transcript epoch", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session"),
    speech = span("speech", "user_speaking", "s");
  speech.startTime = [1, 5_000_000];
  p.onStart(root);
  const provider = new EventEmitter();
  const session: any = { sessionSpan: root };
  provider.on("input_speech_started", () => {
    p.onStart(speech);
    session._userSpeakingSpan = speech;
  });
  p.realtime({ agentSession: session, realtimeSession: provider });
  provider.emit("input_speech_started", {});
  provider.emit("input_audio_transcription_completed", {
    itemId: "user",
    transcript: "Where is my order?",
    turnStartedAt: 1000,
    isFinal: false,
  });
  p.onEnd(speech);
  expect(rows[1].logs).toContainEqual({
    input: [{ role: "user", content: "Where is my order?" }],
  });
  expect(rows[1].args.startTime).toBe(1.005);
});

test("output replacement removes stale transcript evidence and can restore an earlier output", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session"),
    speech = span("a", "agent_speaking", "s");
  p.onStart(root);
  p.onStart(speech);
  const first = new EventEmitter(),
    second = new EventEmitter();
  const session: any = {
    sessionSpan: root,
    agentSpeakingSpan: speech,
    output: { audio: first },
  };
  p.output(session);
  session.output.audio = second;
  p.output(session);
  expect(first.listenerCount("playbackFinished")).toBe(0);
  session.output.audio = first;
  p.output(session);
  expect(second.listenerCount("playbackFinished")).toBe(0);
  first.emit("playbackFinished", { synchronizedTranscript: "partial suffix" });
  p.conversation(session, {
    type: "message",
    id: "first",
    role: "assistant",
    textContent: "Fully played prefix and partial suffix",
    interrupted: true,
  });
  expect(rows[1].logs).toContainEqual({
    output: [
      { role: "assistant", content: "Fully played prefix and partial suffix" },
    ],
  });
  first.emit("playbackFinished", { interrupted: true });
  p.conversation(session, {
    type: "message",
    id: "unverified",
    role: "assistant",
    textContent: "unheard",
    interrupted: true,
  });
  expect(JSON.stringify(rows)).not.toContain("unheard");
});

test("text injected into conversation is not attributed to an earlier untranscribed speech interval", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session"),
    speech = span("u", "user_speaking", "s");
  p.onStart(root);
  p.onStart(speech);
  p.onEnd(speech);
  p.conversation(
    { sessionSpan: root },
    { type: "message", id: "typed", role: "user", textContent: "Typed input" },
  );
  p.onEnd(root);
  expect(rows[1].logs.some((log) => log.input)).toBe(false);
  expect(rows[0].logs).toContainEqual({
    metadata: {
      "contrib.livekit.unassociated_messages": [
        {
          id: "typed",
          role: "user",
          text: "Typed input",
          started_speaking_at: undefined,
        },
      ],
    },
  });
});

test("native recognition ownership survives independently sampled speech timestamps", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session"),
    user = span("u", "user_turn", "s"),
    speech = span("speech", "user_speaking", "u");
  speech.startTime = [1, 5_000_000];
  p.onStart(root);
  p.onStart(user);
  p.onStart(speech);
  p.onEnd(speech);
  const session = { sessionSpan: root };
  p.userTurn(
    { agentSession: session },
    { userTurnSpan: user, startedSpeakingAt: 1000, stoppedSpeakingAt: 2000 },
  );
  p.conversation(session, {
    type: "message",
    id: "caller",
    role: "user",
    textContent: "Where is my order?",
    metrics: { startedSpeakingAt: 1 },
  });
  expect(rows[2].logs).toContainEqual({
    input: [{ role: "user", content: "Where is my order?" }],
  });
  expect(rows[2].args.startTime).toBe(1.005);
});

test("duplex omits adapter turns while preserving speech, models and tool parentage", () => {
  const { rows, span, p } = fixture(true);
  const root = span("s", "agent_session");
  p.onStart(root);
  p.begin({ sessionSpan: root, llm: { duplexModel: {} } });
  const user = span("u", "user_turn", "s");
  const caller = span("us", "user_speaking", "u");
  const agent = span("a", "agent_turn", "s");
  const model = span("m", "realtime_inference", "a");
  const tool = span("t", "function_tool", "m");
  const speech = span("as", "agent_speaking", "a");
  for (const native of [user, caller, agent, model, tool, speech])
    p.onStart(native);
  for (const native of [caller, user, tool, model, speech, agent, root])
    p.onEnd(native);
  expect(rows.map((row) => row.args.name)).toEqual([
    "livekit.agent_session",
    "user_speech",
    "llm_response",
    "livekit.function_tool",
    "agent_speech",
  ]);
  expect(rows.slice(1).map((row) => row.parent)).toEqual([
    rows[0].spanId,
    rows[0].spanId,
    rows[2].spanId,
    rows[0].spanId,
  ]);
  expect(rows.every((row) => row.end)).toBe(true);
  expect(
    rows
      .flatMap((row) => row.logs)
      .flatMap((log) => Object.keys(log.metadata ?? {}))
      .filter((key) => key.startsWith("turn.")),
  ).toEqual([]);
});

test("realtime response links observed caller speech and accepts its late final transcript", () => {
  const { rows, span, p } = fixture(true);
  const root = span("root", "agent_session");
  const speech = span("speech", "user_speaking", "root");
  const realtimeSession = new EventEmitter();
  const session: any = { sessionSpan: root, _userSpeakingSpan: speech };
  const activity: any = { agentSession: session, realtimeSession };
  p.onStart(root);
  p.onStart(speech);
  p.realtime(activity);
  realtimeSession.emit("input_audio_transcription_completed", {
    itemId: "thanks",
    transcript: "Alright",
    isFinal: false,
  });
  const inference = span("model", "realtime_inference", "root");
  p.onStart(inference);
  p.realtime(activity, {
    inferenceSpan: inference,
    ev: { responseId: "response" },
  } as any);
  p.onEnd(inference);
  realtimeSession.emit("input_audio_transcription_completed", {
    itemId: "thanks",
    transcript: "Alright, thank you",
    isFinal: true,
  });
  const model = rows[2];
  expect(model.logs.filter((log) => log.input).at(-1)?.input).toEqual([
    { role: "user", content: "Alright, thank you" },
  ]);
  expect(
    model.logs.filter((log) => log.metadata?.links).at(-1)?.metadata.links,
  ).toEqual([
    {
      context: {
        traceId: "1234567890abcdef1234567890abcdef",
        spanId: rows[1].spanId,
        traceFlags: 1,
      },
      attributes: { "braintrust.relationship.type": "input_context" },
    },
  ]);
  p.onEnd(speech);
  p.onEnd(root);
});
