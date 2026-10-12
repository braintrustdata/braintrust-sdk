import { z } from "zod/v3";

const speaker = z.enum(["user", "agent"]);

const base = z.object({
  seq: z.number().int().nonnegative(),
  at_ms: z.number().nonnegative(),
  basis: z.enum(["audio", "local", "provider"]),
});

const speechStart = base.extend({
  kind: z.literal("speech_start"),
  speaker,
  utterance_id: z.string().min(1),
  response_id: z.string().min(1).optional(),
});

const speechEnd = base.extend({
  kind: z.literal("speech_end"),
  speaker,
  utterance_id: z.string().min(1),
  interrupted: z.boolean().optional(),
  played_ms: z.number().nonnegative().optional(),
});

const transcript = base.extend({
  kind: z.literal("transcript"),
  speaker,
  utterance_id: z.string().min(1),
  final: z.boolean(),
  text: z.string().optional(),
  message_id: z.string().min(1).optional(),
  source: z.enum(["stt", "provider", "playout"]),
});

const message = base.extend({
  kind: z.literal("message"),
  speaker,
  message_id: z.string().min(1),
  utterance_ids: z.array(z.string().min(1)).min(1),
});

const endOfTurn = base.extend({
  kind: z.literal("end_of_turn"),
  utterance_ids: z.array(z.string().min(1)).min(1),
});

const responseStart = base.extend({
  kind: z.literal("response_start"),
  response_id: z.string().min(1),
  span_id: z.string().min(1),
  in_reply_to: z.array(z.string().min(1)).optional(),
});

const toolCall = base.extend({
  kind: z.literal("tool_call"),
  response_id: z.string().min(1),
  tool_call_id: z.string().min(1),
  name: z.string().min(1),
  span_id: z.string().min(1),
});

const toolResult = base.extend({
  kind: z.literal("tool_result"),
  tool_call_id: z.string().min(1),
  span_id: z.string().min(1),
  outcome: z.enum(["ok", "error", "cancelled"]),
});

const truncate = base.extend({
  kind: z.literal("truncate"),
  utterance_id: z.string().min(1),
  audio_end_ms: z.number().nonnegative(),
});

const missing = base.extend({
  kind: z.literal("missing"),
  utterance_id: z.string().min(1).optional(),
  evidence: z.enum([
    "transcript",
    "speech_end",
    "audio",
    "tool_result",
    "timeline",
  ]),
  reason: z.string().min(1),
});

const callEnd = base.extend({
  kind: z.literal("call_end"),
  reason: z.string().min(1),
});

export const voiceEventSchema = z.discriminatedUnion("kind", [
  speechStart,
  speechEnd,
  transcript,
  message,
  endOfTurn,
  responseStart,
  toolCall,
  toolResult,
  truncate,
  missing,
  callEnd,
]);

export const timelineChunkSchema = z.object({
  call_span_id: z.string().min(1),
  chunk_index: z.number().int().nonnegative(),
  final: z.boolean(),
});

export const callSpanMetadataSchema = z.object({
  "voice.timeline_version": z.literal(1),
  "voice.pipeline": z.enum(["cascaded", "realtime", "half_cascade"]),
  "voice.timeline_origin_unix_ms": z.number().optional(),
  "voice.server_vad_silence_ms": z.number().nonnegative().optional(),
});

export const timelineRowMetadataSchema = z.object({
  "voice.timeline": timelineChunkSchema,
  "voice.events": z.array(voiceEventSchema).min(1).max(256),
});

export type VoiceEvent = z.infer<typeof voiceEventSchema>;
export type TimelineChunk = z.infer<typeof timelineChunkSchema>;
