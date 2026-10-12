import { z } from "zod/v3";

const callMs = z.number().nonnegative();

export const selectionSchema = z.object({
  recording_span_id: z.string().min(1),
  recording_id: z.string().min(1),
  start_offset_ms: z.number().nonnegative(),
  end_offset_ms: z.number().nonnegative(),
  channel_index: z.union([z.literal(0), z.literal(1)]),
});

export const voiceMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    seq: z.number().int().nonnegative(),
    committed: z.boolean(),
    state: z.enum(["complete", "interrupted", "unplayed", "open"]),
    text: z.string().optional(),
    text_status: z.enum(["final", "partial", "missing", "not_captured"]),
    text_source: z
      .enum([
        "stt",
        "realtime_input_transcription",
        "tts_input",
        "playout_aligned",
        "realtime_output_transcript",
      ])
      .optional(),
    generated_text: z.string().optional(),
    start_ms: callMs.optional(),
    end_ms: callMs.optional(),
    timing_source: z
      .enum(["vad_events", "provider_events", "playout_events"])
      .optional(),
    end_of_turn_ms: callMs.optional(),
    transcript_final_ms: callMs.optional(),
    interrupted_at_ms: callMs.optional(),
    provider_audio_end_ms: z.number().nonnegative().optional(),
    selections: z.array(selectionSchema),
    produced_by_span_id: z.string().min(1).optional(),
    turn_span_id: z.string().min(1).optional(),
    source_ids: z.record(z.string()).optional(),
  })
  .strict()
  .superRefine((message, ctx) => {
    const issue = (message_: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: message_ });
    if (message.text === undefined) {
      if (message.text_status === "final" || message.text_status === "partial")
        issue("text is required when text_status is final or partial");
    } else if (
      message.text_status === "missing" ||
      message.text_status === "not_captured"
    ) {
      issue("text must be absent when text_status is missing or not_captured");
    }
    if (
      message.start_ms !== undefined &&
      message.end_ms !== undefined &&
      message.end_ms < message.start_ms
    )
      issue("end_ms must not precede start_ms");
    if (!message.committed) {
      if (
        message.role === "user" &&
        (message.state !== "complete" || message.text !== undefined)
      )
        issue("uncommitted user speech is complete and has no text");
      if (
        message.role === "assistant" &&
        message.state !== "unplayed" &&
        message.state !== "interrupted"
      )
        issue("uncommitted assistant speech is unplayed or interrupted");
    }
    if (
      message.state === "unplayed" &&
      (message.selections.length > 0 ||
        message.interrupted_at_ms !== undefined ||
        (message.text_status !== "final" &&
          message.text_status !== "not_captured"))
    )
      issue("unplayed speech has generated text and no played audio");
    const channel = message.role === "user" ? 0 : 1;
    if (message.selections.some((s) => s.channel_index !== channel))
      issue(`${message.role} selections must use channel ${channel}`);
    if (message.role === "user") {
      for (const key of [
        "generated_text",
        "interrupted_at_ms",
        "provider_audio_end_ms",
        "produced_by_span_id",
      ] as const)
        if (message[key] !== undefined) issue(`${key} is assistant-only`);
      if (message.state === "interrupted" || message.state === "unplayed")
        issue(`user messages cannot be ${message.state}`);
    } else {
      for (const key of ["end_of_turn_ms", "transcript_final_ms"] as const)
        if (message[key] !== undefined) issue(`${key} is user-only`);
      if (
        message.state === "interrupted" &&
        message.interrupted_at_ms === undefined
      )
        issue("interrupted assistant messages need interrupted_at_ms");
    }
  });

export const callSpanMetadataSchema = z.object({
  "voice.origin_unix_ms": z.number().positive(),
  "voice.messages": z.record(voiceMessageSchema),
});

export const llmSpanMetadataSchema = z.object({
  "voice.context_message_ids": z.array(z.string().min(1).nullable()).optional(),
  "voice.output_message_id": z.string().min(1).optional(),
});

export type VoiceMessage = z.infer<typeof voiceMessageSchema>;
export type CallSpanVoiceMetadata = z.infer<typeof callSpanMetadataSchema>;
export type LlmSpanVoiceMetadata = z.infer<typeof llmSpanMetadataSchema>;
