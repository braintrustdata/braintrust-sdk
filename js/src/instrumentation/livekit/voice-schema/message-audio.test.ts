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
    committed: false,
    state: "complete",
    text_status: "final",
    text: "mm-hmm",
    selections: [],
  };

  it("accepts an uncommitted backchannel", () => {
    expect(voiceMessageSchema.safeParse(base).success).toBe(true);
  });

  it("rejects text when the transcript is missing", () => {
    expect(
      voiceMessageSchema.safeParse({ ...base, text_status: "missing" }).success,
    ).toBe(false);
  });

  it("rejects user audio on the agent channel", () => {
    expect(
      voiceMessageSchema.safeParse({
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
      }).success,
    ).toBe(false);
  });

  it("requires an interruption point on interrupted agent speech", () => {
    expect(
      voiceMessageSchema.safeParse({
        ...base,
        role: "assistant",
        state: "interrupted",
      }).success,
    ).toBe(false);
  });
});
