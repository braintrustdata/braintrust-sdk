import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import {
  callSpanMetadataSchema,
  llmSpanMetadataSchema,
  voiceMessageSchema,
} from "./message-audio";

const rowSchema = z.object({
  span_id: z.string(),
  root_span_id: z.string(),
  span_parents: z.array(z.string()),
  span_attributes: z.object({ name: z.string(), type: z.string() }),
  metrics: z.object({ start: z.number(), end: z.number() }),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  metadata: z.record(z.unknown()).optional(),
});

function load(name: string) {
  const file = path.resolve(
    __dirname,
    "../../../../../docs/voice-schema/message-audio/examples",
    `${name}.json`,
  );
  return z.array(rowSchema).parse(JSON.parse(readFileSync(file, "utf8")));
}

describe.each(["cascaded", "realtime"])("message-audio %s example", (name) => {
  const rows = load(name);
  const root = rows.find((row) => row.span_parents.length === 0)!;
  const call = callSpanMetadataSchema.parse(root.metadata);
  const messages = Object.entries(call["voice.messages"]);
  const spans = new Map(rows.map((row) => [row.span_id, row]));

  it("has one call span with valid voice messages", () => {
    expect(rows.filter((row) => row.span_parents.length === 0)).toHaveLength(1);
    expect(new Set(messages.map(([, m]) => m.seq)).size).toBe(messages.length);
    for (const [, message] of messages) {
      voiceMessageSchema.parse(message);
      for (const selection of message.selections)
        expect(selection.recording_span_id).toBe(root.span_id);
    }
  });

  it("uses outer bounds of all selections", () => {
    for (const [, message] of messages) {
      if (!message.selections.length) continue;
      expect(
        Math.min(...message.selections.map((s) => s.start_offset_ms)),
      ).toBe(message.start_ms);
      expect(Math.max(...message.selections.map((s) => s.end_offset_ms))).toBe(
        message.end_ms,
      );
    }
  });

  it("links LLM spans to messages by id", () => {
    for (const row of rows.filter((r) => r.span_attributes.type === "llm")) {
      const voice = llmSpanMetadataSchema.parse(row.metadata);
      const ids = voice["voice.context_message_ids"];
      expect(ids).toBeDefined();
      expect(ids).toHaveLength(z.array(z.unknown()).parse(row.input).length);
      const output = voice["voice.output_message_id"];
      if (output !== undefined) {
        const message = call["voice.messages"][output];
        expect(message?.role).toBe("assistant");
        expect(message?.produced_by_span_id).toBe(row.span_id);
      }
    }
    for (const [id, message] of messages) {
      if (message.produced_by_span_id !== undefined)
        expect(
          llmSpanMetadataSchema.parse(
            spans.get(message.produced_by_span_id)?.metadata,
          )["voice.output_message_id"],
        ).toBe(id);
      if (message.role === "user" && message.committed)
        expect(
          rows.some((row) =>
            llmSpanMetadataSchema
              .parse(row.metadata ?? {})
              ["voice.context_message_ids"]?.includes(id),
          ),
        ).toBe(true);
    }
  });
});

describe("message-audio schema", () => {
  const base = {
    role: "user",
    seq: 0,
    committed: true,
    state: "complete",
    text_status: "final",
    text: "Nine thirty works.",
    selections: [],
  };
  const parses = (value: object) => voiceMessageSchema.safeParse(value).success;

  it("accepts uncommitted speech without text", () => {
    const { text: _text, ...rest } = base;
    expect(
      parses({
        ...rest,
        committed: false,
        text_status: "missing",
        text_source: "stt",
      }),
    ).toBe(true);
  });

  it("rejects uncommitted speech with text", () => {
    expect(parses({ ...base, committed: false })).toBe(false);
  });

  it("accepts an expected source when the transcript is missing", () => {
    const { text: _text, ...rest } = base;
    expect(
      parses({
        ...rest,
        text_status: "missing",
        text_source: "realtime_input_transcription",
      }),
    ).toBe(true);
  });

  it("rejects text when the transcript is missing", () => {
    expect(parses({ ...base, text_status: "missing" })).toBe(false);
  });

  it("accepts cancelled assistant speech that never entered the context", () => {
    expect(
      parses({
        ...base,
        role: "assistant",
        committed: false,
        state: "unplayed",
        text_status: "final",
        text_source: "tts_input",
        text: "Let me check.",
      }),
    ).toBe(true);
  });

  it("rejects unplayed speech without generated text", () => {
    const { text: _text, ...rest } = base;
    expect(
      parses({
        ...rest,
        role: "assistant",
        state: "unplayed",
        text_status: "missing",
      }),
    ).toBe(false);
  });

  it("rejects partial text on open assistant speech", () => {
    expect(
      parses({
        ...base,
        role: "assistant",
        state: "open",
        text_status: "partial",
      }),
    ).toBe(false);
  });

  it("rejects uncommitted assistant speech that completed", () => {
    expect(parses({ ...base, role: "assistant", committed: false })).toBe(
      false,
    );
  });

  it("rejects user audio on the agent channel", () => {
    expect(
      parses({
        ...base,
        selections: [
          {
            recording_span_id: "root",
            recording_id: "call-0000",
            start_offset_ms: 0,
            end_offset_ms: 10,
            channel_index: 1,
          },
        ],
      }),
    ).toBe(false);
  });

  it("requires an interruption point on interrupted agent speech", () => {
    expect(parses({ ...base, role: "assistant", state: "interrupted" })).toBe(
      false,
    );
  });
});
