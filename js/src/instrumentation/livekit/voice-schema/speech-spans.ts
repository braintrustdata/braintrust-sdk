import { z } from "zod/v3";

const callMs = z.number().nonnegative();

const selection = z.object({
  recording_span_id: z.string(),
  recording_id: z.string(),
  start_offset_ms: callMs,
  end_offset_ms: callMs,
  channel_index: z.union([z.literal(0), z.literal(1)]),
});

export const voiceCall = z.object({
  framework: z.enum(["livekit", "pipecat"]),
  pipeline: z.enum(["cascaded", "realtime", "half_cascade"]),
  origin_unix_ms: z.number().nonnegative(),
});

export const voiceSpeech = z
  .object({
    speaker: z.enum(["user", "agent"]),
    turn_id: z.string().optional(),
    state: z.enum(["complete", "interrupted", "incomplete", "ignored"]),
    timing_source: z.enum([
      "audio_samples",
      "vad",
      "provider_vad",
      "playout",
      "span_clock",
    ]),
    heard_by: z.array(z.string()).optional(),
    produced_by: z.string().optional(),
    interrupted_by: z.string().optional(),
    played_ms: z.number().positive().optional(),
    provider_played_ms: callMs.optional(),
    end_of_turn_ms: callMs.optional(),
    transcript: z
      .object({
        source: z.enum([
          "stt",
          "provider_transcription",
          "tts_input",
          "model_output",
          "playback_sync",
        ]),
        final: z.boolean(),
        available_ms: callMs.optional(),
        confidence: z.number().min(0).max(1).optional(),
      })
      .optional(),
  })
  .superRefine((speech, ctx) => {
    const agentOnly = [
      "produced_by",
      "interrupted_by",
      "played_ms",
      "provider_played_ms",
    ] as const;
    const userOnly = ["heard_by", "end_of_turn_ms"] as const;
    for (const key of speech.speaker === "user" ? agentOnly : userOnly)
      if (speech[key] !== undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is not allowed on ${speech.speaker} speech`,
          path: [key],
        });
    if (speech.interrupted_by && speech.state !== "interrupted")
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "interrupted_by requires state interrupted",
        path: ["interrupted_by"],
      });
  });

export const speechSpan = z
  .object({
    span_id: z.string(),
    span_parents: z.array(z.string()).length(1),
    span_attributes: z.object({
      name: z.literal("speech"),
      type: z.literal("task"),
    }),
    metrics: z.object({ start: z.number(), end: z.number() }),
    output: z
      .object({
        text: z.string().optional(),
        planned_text: z.string().optional(),
      })
      .optional(),
    metadata: z.object({
      "voice.speech": voiceSpeech,
      "audio.selections": z.array(selection).min(1).optional(),
    }),
  })
  .superRefine((span, ctx) => {
    const speech = span.metadata["voice.speech"];
    if (
      speech.speaker === "agent" &&
      span.output?.text !== undefined &&
      speech.transcript?.source !== "playback_sync"
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agent output.text must be playout-synchronized text",
        path: ["metadata", "voice.speech", "transcript", "source"],
      });
    if (
      span.metadata["voice.speech"].timing_source === "audio_samples" &&
      !span.metadata["audio.selections"]
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "audio_samples timing requires audio.selections",
        path: ["metadata", "voice.speech", "timing_source"],
      });
  });

export type VoiceSpeech = z.infer<typeof voiceSpeech>;
export type SpeechSpan = z.infer<typeof speechSpan>;
