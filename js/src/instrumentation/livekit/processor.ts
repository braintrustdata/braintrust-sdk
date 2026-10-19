import type { AudioRecordingModule, RecordingOptions } from "./audio";
import type { LiveKitOptions } from "./options";
import { resolveAudioOptions } from "./node/audio-options";
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import type {
  AgentSession,
  AgentActivity,
  EndOfTurnInfo,
  ChatMessage,
  AudioFrame,
  AudioOutput,
} from "./types";
import iso from "../../isomorph";
import { runWithAutoInstrumentationSuppressed } from "../auto-instrumentation-suppression";
import {
  parse,
  operation,
  isContentKey,
  messages,
  modelFields,
} from "./schema";
import { SpeechTracker } from "./speech";
import { Relationships } from "./relationships";
import {
  Attachment,
  currentSpan,
  withCurrent,
  type Logger,
} from "../../logger";
import {
  installRuntime,
  nativeId,
  nativeFields,
  observe,
  seconds,
  type NativeSpan,
  type Capture,
  type Row,
} from "./runtime";
import { instrumentInput, instrumentOutput, release, select } from "./capture";
import {
  withSpanInstrumentationName,
  INSTRUMENTATION_NAMES,
} from "../../span-origin";

export { wrapLiveKitSession } from "./wrap";

/**
 * Export native LiveKit traces through the SDK, with optional bounded audio recording.
 * Install in LiveKit's tracer provider INSTEAD OF another Braintrust span processor.
 * Media capture requires the normal braintrust/hook.mjs loader (LiveKit 1.9.x).
 */
export class LiveKitSpanProcessor {
  private execution = iso.newAsyncLocalStorage<{ model?: Row }>();
  readonly rows = new Map<string, Row>();
  readonly captures = new WeakMap<object, Capture>();
  private active = new Set<Capture>();
  private speakingByTurn = new Map<string, Set<Row>>();
  private jobs = new Set<Promise<void>>();
  private uninstall: () => void;
  private captureContent: boolean;
  private audio?: AudioRecordingModule;
  private user: boolean;
  private agent: boolean;
  private sessions = new Map<
    string,
    { speech: SpeechTracker; relationships: Relationships }
  >();
  private outputCleanups = new Map<AgentSession, () => void>();
  private outputs = new Map<AgentSession, AudioOutput>();

  private state(id: string | undefined) {
    return id ? this.sessions.get(id) : undefined;
  }
  constructor(
    private options: LiveKitOptions & {
      logger: Logger<any>;
      recording?: RecordingOptions & { encoder?: { module: string } };
    },
  ) {
    this.captureContent = options.captureContent ?? false;
    const audio = resolveAudioOptions(options);
    this.user = audio.user;
    this.agent = audio.agent;
    this.audio = audio.extension;
    this.uninstall = installRuntime(this);
  }
  /** @internal Applies the native content policy to automatic instrumentation. */
  setContentCapture(enabled: boolean): void {
    this.captureContent = enabled;
  }
  onStart(native: any): void {
    const id = nativeId(native);
    if (!id || this.rows.has(id) || this.rows.size >= 8192) return;
    const parent = native.parentSpanContext?.spanId ?? native.parentSpanId;
    const parentRow = this.rows.get(parent);
    if (native.name !== "agent_session" && !parentRow) return;
    // Native request spans duplicate the public inference lifecycle.
    if (
      parentRow &&
      ["llm_request", "llm_request_run", "tts_request_run"].includes(
        native.name,
      )
    ) {
      const context = native.spanContext();
      this.rows.set(id, {
        ...parentRow,
        native: { name: native.name, spanContext: () => context },
        parent,
        // Retain the native identity for transcript association, not trace grouping.
        folded: true,
        ended: false,
      });
      return;
    }
    const span = (parentRow?.span ?? this.options.logger).startSpan(
      withSpanInstrumentationName(
        {
          name: operation(native.name),
          type:
            native.name === "llm_node"
              ? ("llm" as const)
              : native.name === "function_tool"
                ? ("tool" as const)
                : ("task" as const),
          startTime: seconds(native.startTime),
        },
        INSTRUMENTATION_NAMES.LIVEKIT,
      ),
    );
    // Keep only identity after export; retaining the native SDK span would also
    // retain every historical chat context until session/recording finalization.
    const nativeContext = native.spanContext();
    const row: Row = {
      span,
      start: seconds(native.startTime),
      native: { name: native.name, spanContext: () => nativeContext },
      parent,
      replyTo: parentRow?.replyTo,
      session: native.name === "agent_session" ? id : parentRow?.session,
      turn: ["agent_turn", "user_turn"].includes(native.name)
        ? id
        : parentRow?.turn,
    };
    this.rows.set(id, row);
    if (native.name === "agent_session") {
      const relationships = new Relationships();
      this.sessions.set(id, {
        relationships,
        speech: new SpeechTracker(relationships, this.captureContent),
      });
    }
    const state = this.state(row.session);
    if (["user_speaking", "agent_speaking"].includes(native.name))
      state?.speech.add(row);
    const execution = this.execution.getStore();
    if (native.name === "llm_node" && execution) execution.model = row;
    if (
      ["tts_node", "agent_speaking"].includes(native.name) &&
      execution?.model
    )
      state?.relationships.link(span, execution.model.span, "generated_by");
    if (["agent_speaking", "user_speaking"].includes(native.name) && row.turn) {
      const speaking = this.speakingByTurn.get(row.turn) ?? new Set<Row>();
      speaking.add(row);
      this.speakingByTurn.set(row.turn, speaking);
    }
    if (native.name === "agent_session" && (this.user || this.agent))
      span.log({
        metadata: {
          "audio.recordings": [
            {
              id: "call",
              state: "pending",
            },
          ],
        },
      });
    if (native.name === "function_tool") {
      const request = [...this.rows.values()].find(
        (r) =>
          r.span.spanId === currentSpan().spanId &&
          r.native.name === "llm_node" &&
          r.session === row.session,
      );
      if (request)
        state?.relationships.link(span, request.span, "requested_by");
    }
    if (native.name === "agent_turn") {
      const input = [...this.rows.values()].find(
        (r) =>
          r.span.spanId === currentSpan().spanId &&
          r.native.name === "user_turn" &&
          r.session === row.session,
      );
      if (input) {
        row.replyTo = input.span.spanId;
        span.log({
          metadata: { "turn.reply_to": input.span.spanId },
        });
      }
    }
    if (row.turn)
      span.log({
        metadata: {
          "turn.id": this.rows.get(row.turn)?.span.spanId,
        },
      });
  }
  onEnd(native: NativeSpan): void {
    const row = this.rows.get(nativeId(native)!);
    if (!row) return;
    const attrs = nativeFields(native.attributes);
    for (const key of Object.keys(attrs))
      if (!this.captureContent && isContentKey(key)) delete attrs[key];
    const metadata = Object.fromEntries(
      Object.entries(attrs).filter(
        ([key]) => !isContentKey(key) && !key.startsWith("langfuse."),
      ),
    );
    if (row.folded) {
      if (native.name === "llm_request") {
        const fields = modelFields(attrs);
        row.span.log({
          ...fields,
          metadata: {
            ...fields.metadata,
          },
        });
      }
      row.ended = true;
      return;
    }
    const events = (native.events ?? []).slice(0, 256).map((e) => ({
      name: e.name,
      time_unix_ms: seconds(e.time) * 1000,
      attributes: Object.fromEntries(
        Object.entries(nativeFields(e.attributes)).filter(
          ([key]) => this.captureContent || !isContentKey(key),
        ),
      ),
    }));
    const toolName =
      attrs["contrib.livekit.function_tool.name"] ?? attrs["gen_ai.tool.name"];
    row.span.log({
      metadata: {
        ...metadata,
        ...(events.length ? { "contrib.livekit.events": events } : {}),
      },
      ...(toolName
        ? { span_attributes: { name: toolName, type: "tool" } }
        : {}),
      ...(native.status?.code === 2
        ? {
            error: this.captureContent
              ? (native.status.message ?? "LiveKit operation failed")
              : "LiveKit operation failed",
          }
        : {}),
    });
    const fields = modelFields(attrs);
    row.span.log({
      metadata: fields.metadata,
      ...(native.name === "llm_node" ? { metrics: fields.metrics } : {}),
    });
    if (this.captureContent) {
      if (native.name === "llm_node") {
        const input =
          messages(attrs["contrib.livekit.pii.chat_ctx"]) ??
          messages(attrs["gen_ai.input.messages"]);
        let output = messages(attrs["gen_ai.output.messages"]);
        if (!output?.length) {
          const text = attrs["contrib.livekit.pii.response.text"];
          const calls =
            parse(attrs["contrib.livekit.pii.response.function_calls"]) ??
            messages(attrs["gen_ai.output.messages"])?.flatMap(
              (message) => message.tool_calls ?? [],
            );
          output = messages([
            ...(typeof text === "string"
              ? [{ role: "assistant", content: text }]
              : []),
            ...(Array.isArray(calls)
              ? calls.map((call) => ({
                  ...call,
                  type: "function_call",
                  call_id: call.call_id ?? call.callId ?? call.id,
                }))
              : []),
          ]);
        }
        row.span.log({
          ...(input ? { input } : {}),
          ...(output?.length ? { output } : {}),
        });
      } else if (native.name === "tts_node") {
        const text = attrs["contrib.livekit.pii.input_text"];
        if (typeof text === "string")
          row.span.log({
            input: { text },
            output: [{ role: "assistant", content: text }],
          });
      }
      if (toolName)
        row.span.log({
          input: parse(
            attrs["contrib.livekit.pii.function_tool.arguments"] ??
              attrs["gen_ai.tool.call.arguments"],
          ),
          output: parse(
            attrs["contrib.livekit.pii.function_tool.output"] ??
              attrs["gen_ai.tool.call.result"],
          ),
        });
    }
    this.correlate(row, attrs);
    const replyTo = row.replyTo ?? this.rows.get(row.turn ?? "")?.replyTo;
    if (replyTo) row.span.log({ metadata: { "turn.reply_to": replyTo } });
    if (native.name === "user_speaking") {
      const capture = [...this.active].find(
        (c) => c.row.session === row.session,
      );
      if (capture?.user) {
        for (const packet of capture.inputTimeline) {
          const from = Math.max(
            packet.at,
            seconds(native.startTime) * 1000 - capture.origin,
          );
          const to = Math.min(
            packet.at + packet.duration,
            seconds(native.endTime) * 1000 - capture.origin,
          );
          if (to > from) {
            select(capture, nativeId(native)!, from, to, 0);
          }
        }
        this.publishSelections(capture);
      }
    }
    row.end = seconds(native.endTime);
    row.ended = true;
    row.span.end({ endTime: seconds(native.endTime) });
    if (native.name === "agent_session") {
      const capture = [...this.active].find((c) => c.row === row);
      if (capture) this.track(this.finish(capture.session));
      else {
        if (this.user || this.agent)
          row.span.log({
            metadata: {
              "audio.recordings": [
                {
                  id: "call",
                  state: "omitted",
                  reason: "capture_hooks_not_observed",
                },
              ],
            },
          });
        this.clearSession(nativeId(native)!);
      }
    } else if (
      row.session &&
      this.rows.get(row.session)?.ended &&
      ![...this.active].some((c) => c.row.session === row.session)
    ) {
      this.clearSession(row.session);
    }
  }
  scope<T>(native: any, fn: () => T): T {
    const row = this.rows.get(nativeId(native)!);
    return row
      ? this.execution.run(
          {
            model: row.native.name === "llm_node" ? row : undefined,
          },
          () => withCurrent(row.span, fn),
        )
      : fn();
  }
  inference<T>(fn: () => T): T {
    // Only the inference worker is suppressed, not the pipeline or user tools.
    // An installed processor must not suppress unrelated/untracked sessions.
    const execution = this.execution.getStore();
    if (!execution) return fn();
    const result = runWithAutoInstrumentationSuppressed(fn);
    // LiveKit's inference factory returns [task, generationData]. The data ID
    // is the committed message ID, not the provider's response ID.
    const data = Array.isArray(result) ? result[1] : undefined;
    if (execution.model && typeof data?.id === "string")
      this.state(execution.model.session)?.relationships.register(
        `generation:${data.id}`,
        execution.model.span,
      );
    return result;
  }
  conversation(session: AgentSession, item: ChatMessage): void {
    if (item?.type !== "message") return;
    const sessionId = nativeId(session.sessionSpan);
    const current = [...this.rows.values()].find(
      (r) => r.span.spanId === currentSpan().spanId && r.session === sessionId,
    );
    const turn =
      current?.turn ??
      (item.role === "assistant"
        ? nativeId(session.activity?.currentSpeech?._agentTurnSpan)
        : undefined);
    // LiveKit falls back to the entire generated text on partial playback when
    // its output has no synchronized transcript. That fallback is not heard text.
    const verified = this.rows.get(
      nativeId(session.agentSpeakingSpan) ?? "",
    )?.playedText;
    const played =
      item.role === "assistant" && item.interrupted
        ? verified === undefined
          ? undefined
          : // A pipeline commit can include earlier fully played segments followed
            // by the synchronized partial suffix. Preserve that verified prefix too.
            item.textContent?.endsWith(verified)
            ? item.textContent
            : verified
        : item.textContent;
    this.state(sessionId)?.speech.message(
      { ...item, textContent: played },
      { turn },
    );
  }
  private context(row: Row, context: unknown) {
    const parsed = parse(context) as any;
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(items)) return;
    const relationships = this.state(row.session)?.relationships;
    for (const item of items) {
      if (item?.type === "function_call_output") {
        const callId = item.call_id ?? item.callId;
        if (typeof callId === "string")
          relationships?.reference(
            row.span,
            `tool:${callId}`,
            "consumes_tool_result",
          );
      } else if (
        typeof item?.id === "string" &&
        (!item.type || item.type === "message")
      )
        relationships?.reference(
          row.span,
          `speech:${item.id}`,
          "input_context",
        );
    }
  }
  private correlate(row: Row, attrs: Record<string, any>) {
    const relationships = this.state(row.session)?.relationships;
    const calls =
      parse(attrs["contrib.livekit.pii.response.function_calls"]) ??
      messages(attrs["gen_ai.output.messages"])?.flatMap(
        (message) => message.tool_calls ?? [],
      );
    if (Array.isArray(calls))
      for (const call of calls) {
        const id = call?.call_id ?? call?.callId ?? call?.id;
        if (typeof id === "string")
          relationships?.register(`request:${id}`, row.span);
      }
    const callId =
      attrs["gen_ai.tool.call.id"] ?? attrs["contrib.livekit.function_tool.id"];
    if (row.native.name === "function_tool" && typeof callId === "string") {
      relationships?.register(`tool:${callId}`, row.span);
      relationships?.reference(row.span, `request:${callId}`, "requested_by");
    }
    if (row.native.name === "llm_node")
      this.context(row, attrs["contrib.livekit.pii.chat_ctx"]);
  }

  begin(session: AgentSession): void {
    if (
      this.captures.has(session) ||
      !this.audio ||
      (!this.user && !this.agent)
    )
      return;
    const row = this.rows.get(nativeId(session.sessionSpan)!);
    if (!row) return;
    const voice = this.audio.createVoiceRecording({
      options: this.options.recording,
      encoder: this.options.recording?.encoder,
      span: row.span,
      flush: () => this.options.logger.flush(),
      createAttachment: (options) => new Attachment(options),
      snapshot: () => ({
        origin: capture.origin,
        basis: "local_input_arrival_and_output_playout",
        source: (channel) => ({
          channel_index: channel,
          boundary: channel === 0 ? "session_input" : "local_audio_output",
        }),
        metadata: {
          "contrib.livekit.audio.input_formats": [
            ...(capture.recording.formats.get(0)?.values() ?? []),
          ],
          "contrib.livekit.audio.output_formats": [
            ...(capture.recording.formats.get(1)?.values() ?? []),
          ],
        },
      }),
      speechSelections: () => this.speechSelections(capture),
    });
    const capture: Capture = {
      session,
      row,
      user: this.user,
      agent: this.agent,
      origin: Date.now(),
      recording: voice.audio,
      timeline: this.audio.timeline,
      inputTimeline: [],
      inputDurationMs: 0,
      outputHolds: new Map(),
      closed: false,
      selections: new Map(),
      events: new Map(),
      cleanups: [],
    };
    capture.publishSelections = () => voice.publishSelections();
    this.captures.set(session, capture);
    this.active.add(capture);
    row.span.log({
      metadata: { "audio.recordings": [{ id: "call", state: "pending" }] },
    });
  }
  input(activity: AgentActivity, stream: ReadableStream<AudioFrame>): void {
    const capture = this.captures.get(activity.agentSession);
    if (capture) instrumentInput(capture, stream);
  }
  output(session: AgentSession): void {
    const sink = session.output?.audio;
    if (this.outputs.get(session) !== sink) {
      this.outputCleanups.get(session)?.();
      this.outputCleanups.delete(session);
      this.outputs.delete(session);
      if (sink) {
        const finished = (event: any) =>
          observe(() => {
            const row = this.rows.get(
              nativeId(session.agentSpeakingSpan) ?? "",
            );
            if (row)
              row.playedText =
                this.captureContent &&
                typeof event.synchronizedTranscript === "string"
                  ? event.synchronizedTranscript
                  : undefined;
          });
        sink.on("playbackFinished", finished);
        this.outputs.set(session, sink);
        this.outputCleanups.set(session, () =>
          sink.off?.("playbackFinished", finished),
        );
      }
    }
    const capture = this.captures.get(session);
    if (capture)
      instrumentOutput(capture, session.output?.audio, this.captureContent);
  }
  userTurn(activity: AgentActivity, info: EndOfTurnInfo): void {
    const turnId = nativeId(info.userTurnSpan);
    if (turnId && info.startedSpeakingAt !== undefined)
      this.state(nativeId(activity.agentSession.sessionSpan))?.speech.recognize(
        turnId,
        info.startedSpeakingAt,
      );
    const c = this.captures.get(activity.agentSession);
    if (!c || c.closed || !c.user) return;
    const id = nativeId(info.userTurnSpan);
    // Native recognition speech boundaries share the local wall clock. Clip actual captured
    // samples; never derive selection from the broader user_turn span's start/end timestamps.
    if (
      !id ||
      !Number.isFinite(info.startedSpeakingAt) ||
      !Number.isFinite(info.stoppedSpeakingAt)
    )
      return;
    for (const p of c.inputTimeline) {
      const from = Math.max(p.at, info.startedSpeakingAt! - c.origin);
      const to = Math.min(
        p.at + p.duration,
        info.stoppedSpeakingAt! - c.origin,
      );
      if (to > from) select(c, id, from, to, 0);
    }
    this.publishSelections(c);
  }
  finish(session: AgentSession): Promise<void> {
    this.outputCleanups.get(session)?.();
    this.outputCleanups.delete(session);
    this.outputs.delete(session);
    const c = this.captures.get(session);
    if (!c) return Promise.resolve();
    if (!c.finish) {
      c.finish = this.finalize(c);
      this.track(c.finish);
    }
    return c.finish;
  }
  private track(job: Promise<void>) {
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job)).catch(() => {});
  }
  private publishSelections(c: Capture) {
    c.publishSelections?.();
  }
  private *speechSelections(c: Capture) {
    for (const [native, intervals] of c.selections) {
      if (this.rows.get(native)?.folded) continue;
      const span = this.rows.get(native)?.span ?? c.externalSpans?.get(native);
      if (!span) continue;
      yield {
        span,
        intervals,
        alias: true,
        metadata: c.events.has(native)
          ? { "contrib.livekit.playback_events": c.events.get(native) }
          : {},
      };
      const speaking = [...(this.speakingByTurn.get(native) ?? [])];
      if (
        speaking.length === 1 &&
        !c.selections.has(nativeId(speaking[0].native)!)
      )
        yield { span: speaking[0].span, intervals };
    }
  }
  private async finalize(c: Capture) {
    for (const cleanup of c.cleanups.splice(0)) observe(cleanup);
    c.closed = true;
    const id = nativeId(c.row.native)!;
    try {
      await c.recording.finish();
      c.row.span.log({
        metadata: {
          "contrib.livekit.audio.input_clock":
            "arrival_anchored_ordered_samples",
        },
      });
    } finally {
      release(c);
      this.captures.delete(c.session);
      c.session = undefined;
      this.active.delete(c);
      this.clearSession(id);
    }
  }
  private clearSession(id: string) {
    // Native children (notably tools) can outlive session end. Retain ownership until
    // every native operation finishes, even after the recording has finalized.
    if ([...this.rows.values()].some((row) => row.session === id && !row.ended))
      return;
    const root = this.rows.get(id);
    if (root) this.state(id)?.speech.finish(root.span);
    for (const [key, row] of this.rows)
      if (row.session === id) {
        this.rows.delete(key);
        if (row.turn) this.speakingByTurn.delete(row.turn);
      }
    this.sessions.delete(id);
  }
  async forceFlush(): Promise<void> {
    await Promise.all([...this.active].map((c) => c.recording.drain()));
    await Promise.all([...this.jobs]);
    await this.options.logger.flush();
  }
  async shutdown(): Promise<void> {
    await Promise.all([...this.active].map((c) => this.finish(c.session)));
    for (const row of this.rows.values())
      if (!row.ended && !row.folded) {
        row.span.log({
          metadata: {
            ...(row.turn === nativeId(row.native)
              ? { "turn.incomplete": true }
              : { "contrib.livekit.incomplete": true }),
            "contrib.livekit.termination": "processor_shutdown",
          },
        });
        row.span.end();
      }
    for (const [id, state] of this.sessions) {
      const root = this.rows.get(id);
      if (root) state.speech.finish(root.span);
    }
    this.rows.clear();
    this.speakingByTurn.clear();
    this.sessions.clear();
    for (const cleanup of this.outputCleanups.values()) cleanup();
    this.outputCleanups.clear();
    this.outputs.clear();
    try {
      await this.forceFlush();
    } finally {
      this.uninstall();
    }
  }
}
