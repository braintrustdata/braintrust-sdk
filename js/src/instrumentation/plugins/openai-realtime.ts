import { startSpan, withCurrent, type Span } from "../../logger";
import { debugLogger } from "../../debug-logger";
import { getCurrentUnixTimestamp } from "../../util";
import {
  INSTRUMENTATION_NAMES,
  withSpanInstrumentationName,
} from "../../span-origin";
import { isObject } from "../../../util/index";
import {
  convertDataToBlob,
  processInputAttachments,
} from "../../wrappers/attachment-utils";
import { Attachment } from "../../logger";
import type {
  OpenAIRealtimeConnection,
  OpenAIRealtimeEvent,
} from "../../vendor-sdk-types/openai-media";
import { openAIChannels } from "./openai-channels";
import { mediaUsage } from "./openai-media";

type Turn = {
  span: Span;
  start: number;
  first: boolean;
  audio: Map<string, Blob[]>;
};
type Session = {
  span: Span;
  metadata: Record<string, unknown>;
  turns: Map<string, Turn>;
  items: Map<string, unknown>;
  tools: Map<string, Span>;
  pending: Array<{ start: number; response?: OpenAIRealtimeEvent["response"] }>;
  inputAudio: Blob[];
  inputFormat: string;
  outputFormat: string;
  closed: boolean;
  cleanup: () => void;
};

// A session belongs to the connection, not the ambient context of socket callbacks.
let sessions = new WeakMap<OpenAIRealtimeConnection, Session>();

const activeSessions = new Set<Session>();

function realtimeItem(
  item: Record<string, unknown>,
  format: string,
): Record<string, unknown> {
  if (!Array.isArray(item.content)) return item;
  return {
    ...item,
    content: item.content.map((part: unknown) => {
      if (!isObject(part)) return part;
      if (typeof part.audio === "string") {
        const blob = convertDataToBlob(part.audio, format);
        return {
          ...part,
          audio: blob
            ? new Attachment({
                data: blob,
                contentType: format,
                filename: `audio.${format === "audio/pcm" ? "pcm" : "bin"}`,
              })
            : part.audio,
        };
      }
      return processInputAttachments(part);
    }),
  };
}

function closeSession(state: Session): void {
  if (state.closed) return;
  state.closed = true;
  activeSessions.delete(state);
  for (const turn of state.turns.values()) {
    turn.span.log({ metadata: { status: "interrupted" } });
    turn.span.end();
  }
  for (const span of state.tools.values()) {
    span.log({ metadata: { status: "interrupted" } });
    span.end();
  }
  state.turns.clear();
  state.tools.clear();
  state.inputAudio = [];
  state.pending = [];
  state.items.clear();
  state.span.end();
  state.cleanup();
}

function observeEvent(
  state: Session,
  event: OpenAIRealtimeEvent,
  outgoing = false,
): void {
  if (state.closed) return;
  if (outgoing && event.type === "response.create")
    state.pending.push({
      start: getCurrentUnixTimestamp(),
      response: event.response,
    });
  if (
    event.type === "session.created" ||
    event.type === "session.updated" ||
    event.type === "session.update"
  ) {
    const session = event.session ?? {};
    // Never serialize client_secret, tokens, transport URLs, or arbitrary session fields.
    for (const key of [
      "model",
      "voice",
      "instructions",
      "modalities",
      "output_modalities",
      "tools",
      "tool_choice",
      "turn_detection",
      "temperature",
    ]) {
      if (Object.hasOwn(session, key)) state.metadata[key] = session[key];
    }
    if (typeof session.input_audio_format === "string")
      state.inputFormat = session.input_audio_format;
    if (typeof session.output_audio_format === "string")
      state.outputFormat = session.output_audio_format;
    if (isObject(session.audio)) {
      for (const direction of ["input", "output"]) {
        const audio = session.audio[direction];
        if (
          isObject(audio) &&
          isObject(audio.format) &&
          typeof audio.format.type === "string"
        ) {
          if (direction === "input") state.inputFormat = audio.format.type;
          else state.outputFormat = audio.format.type;
        }
      }
    }
    const legacyFormats = new Map([
      ["pcm16", "audio/pcm"],
      ["g711_ulaw", "audio/pcmu"],
      ["g711_alaw", "audio/pcma"],
    ]);
    state.inputFormat =
      legacyFormats.get(state.inputFormat) ?? state.inputFormat;
    state.outputFormat =
      legacyFormats.get(state.outputFormat) ?? state.outputFormat;
    state.span.log({ metadata: state.metadata });
  }
  if (outgoing && event.type === "input_audio_buffer.append" && event.audio) {
    const blob = convertDataToBlob(event.audio, state.inputFormat);
    if (blob) state.inputAudio.push(blob);
  }
  if (event.type === "input_audio_buffer.clear") state.inputAudio = [];
  if (
    event.type === "input_audio_buffer.committed" &&
    event.item_id &&
    state.inputAudio.length
  ) {
    state.items.set(event.item_id, {
      role: "user",
      content: [
        {
          type: "input_audio",
          audio: new Attachment({
            data: new Blob(state.inputAudio, { type: state.inputFormat }),
            contentType: state.inputFormat,
            filename: "input-audio.pcm",
          }),
        },
      ],
    });
    state.inputAudio = [];
  }
  if (event.type === "conversation.item.deleted" && event.item_id)
    state.items.delete(event.item_id);
  if (
    event.type === "conversation.item.input_audio_transcription.completed" &&
    event.item_id
  ) {
    const item = state.items.get(event.item_id);
    state.items.set(event.item_id, {
      ...(isObject(item) ? item : {}),
      transcript: event.transcript,
    });
  }
  if (
    [
      "conversation.item.create",
      "conversation.item.created",
      "conversation.item.added",
      "conversation.item.done",
    ].includes(event.type) &&
    event.item
  ) {
    const item = event.item;
    if (typeof item.id === "string") {
      const previous = state.items.get(item.id);
      const mapped = realtimeItem(item, state.inputFormat);
      // Server acknowledgements omit the bytes sent through input_audio_buffer.
      // Retain the already captured attachment when updating that item's fields.
      if (
        isObject(previous) &&
        Array.isArray(previous.content) &&
        Array.isArray(mapped.content)
      ) {
        const previousContent = previous.content;
        mapped.content = mapped.content.map((part: unknown, index: number) => {
          const existing = previousContent[index];
          return isObject(part) &&
            isObject(existing) &&
            existing.audio !== undefined &&
            part.audio === undefined
            ? { ...part, audio: existing.audio }
            : part;
        });
      }
      state.items.set(item.id, mapped);
    }
    if (
      item.type === "function_call_output" &&
      typeof item.call_id === "string"
    ) {
      const tool = state.tools.get(item.call_id);
      if (tool) {
        tool.log({ output: item.output });
        tool.end();
        state.tools.delete(item.call_id);
      }
    }
  }
  const response = event.response;
  const id = response?.id ?? event.response_id;
  if (event.type === "response.created" && id && !state.turns.has(id)) {
    const pending = state.pending.shift();
    const start = pending?.start ?? getCurrentUnixTimestamp();
    const span = withCurrent(state.span, () =>
      startSpan(
        withSpanInstrumentationName(
          {
            name: "openai.realtime.response",
            type: "llm" as const,
            startTime: start,
            event: {
              input: Array.isArray(pending?.response?.input)
                ? pending.response.input.map((item) =>
                    isObject(item)
                      ? realtimeItem(item, state.inputFormat)
                      : item,
                  )
                : [...state.items.values()],
              metadata: {
                ...state.metadata,
                ...(response?.model ? { model: response.model } : {}),
              },
            },
          },
          INSTRUMENTATION_NAMES.OPENAI,
        ),
      ),
    );
    state.turns.set(id, {
      span,
      start,
      first: false,
      audio: new Map(),
    });
  }
  const turn = id ? state.turns.get(id) : undefined;
  if (turn && event.type.endsWith(".delta") && event.delta) {
    if (
      !turn.first &&
      /(?:text|audio|transcript|function_call_arguments)\.delta$/.test(
        event.type,
      )
    ) {
      turn.first = true;
      turn.span.log({
        metrics: {
          time_to_first_token: getCurrentUnixTimestamp() - turn.start,
        },
      });
    }
    if (
      event.type === "response.audio.delta" ||
      event.type === "response.output_audio.delta"
    ) {
      const key = `${event.output_index ?? 0}:${event.content_index ?? 0}`;
      const chunks = turn.audio.get(key) ?? [];
      const blob = convertDataToBlob(event.delta, state.outputFormat);
      if (blob) chunks.push(blob);
      turn.audio.set(key, chunks);
    }
  }
  if (turn && event.type === "response.done" && response) {
    const output = (response.output ?? []).map((item, outputIndex) => {
      const mapped = realtimeItem(item, state.outputFormat);
      if (!isObject(mapped) || !Array.isArray(mapped.content)) return mapped;
      return {
        ...mapped,
        content: mapped.content.map((part: unknown, contentIndex: number) => {
          const audio = turn.audio.get(`${outputIndex}:${contentIndex}`);
          if (!audio?.length || !isObject(part)) return part;
          return {
            ...part,
            audio: new Attachment({
              data: new Blob(audio, { type: state.outputFormat }),
              contentType: state.outputFormat,
              filename: "output-audio.pcm",
            }),
          };
        }),
      };
    });
    turn.span.log({
      output,
      metrics: mediaUsage(response.usage),
      metadata: {
        status: response.status,
        ...(response.model ? { model: response.model } : {}),
      },
    });
    if (response.status === "failed")
      turn.span.log({
        error: new Error(
          JSON.stringify(response.status_details ?? "Realtime response failed"),
        ),
      });
    for (const [index, item] of (response.output ?? []).entries()) {
      if (typeof item.id === "string") state.items.set(item.id, output[index]);
      if (
        item.type === "function_call" &&
        typeof item.call_id === "string" &&
        !state.tools.has(item.call_id)
      ) {
        const tool = withCurrent(turn.span, () =>
          startSpan(
            withSpanInstrumentationName(
              {
                name:
                  typeof item.name === "string"
                    ? item.name
                    : "openai.realtime.tool",
                type: "tool" as const,
                event: {
                  input: item.arguments,
                  metadata: { provider: "openai", tool_call_id: item.call_id },
                },
              },
              INSTRUMENTATION_NAMES.OPENAI,
            ),
          ),
        );
        state.tools.set(item.call_id, tool);
      }
    }
    turn.span.end();
    state.turns.delete(id!);
  }
  if (event.type === "error") {
    const error = new Error(event.error?.message ?? "Realtime error");
    state.span.log({ error });
    if (turn) {
      turn.span.log({ error });
      turn.span.end();
      state.turns.delete(id!);
    }
  }
}

function instrumentRealtime(
  connection: OpenAIRealtimeConnection,
): OpenAIRealtimeConnection {
  if (sessions.has(connection)) return connection;
  const state: Session = {
    span: startSpan(
      withSpanInstrumentationName(
        {
          name: "openai.realtime.session",
          type: "task" as const,
          event: {
            metadata: {
              provider: "openai",
              model:
                connection.url?.searchParams.get("model") ??
                connection.url?.searchParams.get("deployment") ??
                undefined,
            },
          },
        },
        INSTRUMENTATION_NAMES.OPENAI,
      ),
    ),
    metadata: {
      provider: "openai",
      model:
        connection.url?.searchParams.get("model") ??
        connection.url?.searchParams.get("deployment") ??
        undefined,
    },
    turns: new Map(),
    items: new Map(),
    tools: new Map(),
    pending: [],
    inputAudio: [],
    inputFormat: "audio/pcm",
    outputFormat: "audio/pcm",
    closed: false,
    cleanup: () => {},
  };
  sessions.set(connection, state);
  activeSessions.add(state);
  const receive = (event: OpenAIRealtimeEvent) => {
    try {
      observeEvent(state, event);
    } catch (error) {
      debugLogger.debug("OpenAI Realtime event capture failed", error);
    }
  };
  const close = () => {
    try {
      closeSession(state);
    } catch (error) {
      debugLogger.debug("OpenAI Realtime close failed", error);
    }
  };
  const onSocketError = (event?: unknown) => {
    try {
      state.span.log({
        error:
          event instanceof Error
            ? event
            : new Error(
                isObject(event) && typeof event.message === "string"
                  ? event.message
                  : "Realtime connection error",
              ),
      });
    } catch (error) {
      debugLogger.debug("OpenAI Realtime error capture failed", error);
    }
  };
  connection.on("event", receive);
  connection.socket?.addEventListener?.("close", close);
  if (!connection.socket?.addEventListener)
    connection.socket?.on?.("close", close);
  connection.socket?.addEventListener?.("error", onSocketError);
  if (!connection.socket?.addEventListener)
    connection.socket?.on?.("error", onSocketError);
  state.cleanup = () => {
    connection.off("event", receive);
    connection.socket?.removeEventListener?.("close", close);
    connection.socket?.off?.("close", close);
    connection.socket?.removeEventListener?.("error", onSocketError);
    connection.socket?.off?.("error", onSocketError);
  };
  const originalSend = connection.send;
  connection.send = function (event) {
    try {
      observeEvent(state, event, true);
    } catch (error) {
      debugLogger.debug("OpenAI Realtime send capture failed", error);
    }
    return originalSend.call(this, event);
  };
  const originalClose = connection.close;
  connection.close = function (...args) {
    try {
      return originalClose.apply(this, args);
    } finally {
      close();
    }
  };
  return connection;
}

export function interceptOpenAIRealtime(): Array<() => void> {
  return [
    () => {
      for (const state of activeSessions) closeSession(state);
      sessions = new WeakMap();
    },
    openAIChannels.realtimeConnect.intercept((target, thisArg, args) => {
      const result = target.apply(thisArg, args);
      try {
        instrumentRealtime(result);
      } catch (error) {
        debugLogger.debug("OpenAI Realtime instrumentation failed", error);
      }
      return result;
    }),
    ...[openAIChannels.realtimeOn, openAIChannels.realtimeSend].map((channel) =>
      channel.intercept((target, thisArg, args) => {
        try {
          const connection = thisArg as OpenAIRealtimeConnection;
          const first = !sessions.has(connection);
          instrumentRealtime(connection);
          if (first && channel === openAIChannels.realtimeSend)
            observeEvent(
              sessions.get(connection)!,
              args[0] as OpenAIRealtimeEvent,
              true,
            );
        } catch (error) {
          debugLogger.debug("OpenAI Realtime instrumentation failed", error);
        }
        return Reflect.apply(target, thisArg, args);
      }),
    ),
  ];
}
