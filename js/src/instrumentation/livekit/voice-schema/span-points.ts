import { z } from "zod/v3";

const speaker = z.enum(["user", "agent"]);
const id = z.string().min(1);

const base = z.object({
  at_ms: z.number().nonnegative(),
  basis: z.enum(["audio", "local", "provider"]),
});

const speechStart = base.extend({
  kind: z.literal("speech_start"),
  speaker,
  utterance_id: id,
  response_id: id.optional(),
});

const speechEnd = base.extend({
  kind: z.literal("speech_end"),
  speaker,
  utterance_id: id,
  interrupted: z.boolean().optional(),
  played_ms: z.number().nonnegative().optional(),
  interrupted_by: id.optional(),
});

const transcript = base.extend({
  kind: z.literal("transcript"),
  speaker,
  utterance_id: id,
  final: z.boolean(),
  text: z.string().optional(),
  message_id: id.optional(),
  source: z.enum(["stt", "provider", "playout"]),
});

const message = base.extend({
  kind: z.literal("message"),
  speaker,
  message_id: id,
  utterance_ids: z.array(id).min(1),
});

const endOfTurn = base.extend({
  kind: z.literal("end_of_turn"),
  utterance_ids: z.array(id).min(1),
});

const responseStart = base.extend({
  kind: z.literal("response_start"),
  response_id: id,
  in_reply_to: z.array(id).optional(),
});

const toolCall = base.extend({
  kind: z.literal("tool_call"),
  response_id: id,
  tool_call_id: id,
});

const toolResult = base.extend({
  kind: z.literal("tool_result"),
  tool_call_id: id,
  outcome: z.enum(["ok", "error", "cancelled"]),
});

const truncate = base.extend({
  kind: z.literal("truncate"),
  utterance_id: id,
  audio_end_ms: z.number().nonnegative(),
});

const missing = base.extend({
  kind: z.literal("missing"),
  utterance_id: id.optional(),
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

export const voicePointSchema = z.discriminatedUnion("kind", [
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

export const voicePointsSchema = z
  .record(z.string().regex(/^(0|[1-9][0-9]*)$/), voicePointSchema)
  .refine((points) => Object.keys(points).length <= 256);

export const callSpanMetadataSchema = z.object({
  "voice.points_version": z.literal(1),
  "voice.pipeline": z.enum(["cascaded", "realtime", "half_cascade"]),
  "voice.origin_unix_ms": z.number().optional(),
  "voice.server_vad_silence_ms": z.number().nonnegative().optional(),
  "voice.points": voicePointsSchema.optional(),
});

export const spanMetadataSchema = z.object({
  "voice.points": voicePointsSchema,
});

export type VoicePoint = z.infer<typeof voicePointSchema>;
export type VoicePointKind = VoicePoint["kind"];

// The span types allowed to own each point kind. Ownership follows who observed the fact,
// never which operation happened to be running.
export const pointOwners: Record<VoicePointKind, readonly string[]> = {
  speech_start: ["user_turn", "assistant_turn", "call"],
  speech_end: ["user_turn", "assistant_turn", "call"],
  transcript: ["user_turn", "assistant_turn", "call"],
  message: ["user_turn", "assistant_turn", "call"],
  end_of_turn: ["user_turn"],
  response_start: ["llm"],
  tool_call: ["tool"],
  tool_result: ["tool"],
  truncate: ["assistant_turn"],
  missing: ["user_turn", "assistant_turn", "call"],
  call_end: ["call"],
};
