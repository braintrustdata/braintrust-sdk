import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod/v3";
import { speechSpan, voiceCall } from "./speech-spans";

type Row = {
  span_id: string;
  span_parents: string[] | null;
  span_attributes: { name: string; type: string };
  metadata?: Record<string, unknown>;
};

const examples = path.resolve(
  __dirname,
  "../../../../../docs/voice-schema/speech-spans/examples",
);

describe.each(["cascaded", "realtime"])("%s example", (name) => {
  const rows: Row[] = JSON.parse(
    readFileSync(path.join(examples, `${name}.json`), "utf8"),
  );
  const byId = new Map(rows.map((row) => [row.span_id, row]));
  const speech = rows
    .filter((row) => row.metadata?.["voice.speech"])
    .map((row) => speechSpan.parse(row));

  test("the call span declares its pipeline", () => {
    const call = rows.find((row) => row.span_parents === null);
    expect(voiceCall.parse(call?.metadata?.["voice.call"]).pipeline).toBe(name);
  });

  test("speech links resolve to spans of the right kind", () => {
    expect(speech).toHaveLength(4);
    for (const span of speech) {
      const voice = span.metadata["voice.speech"];
      if (voice.turn_id) expect(span.span_parents).toEqual([voice.turn_id]);
      for (const id of voice.heard_by ?? [])
        expect(byId.get(id)?.span_attributes.type).toBe("llm");
      if (voice.produced_by)
        expect(byId.get(voice.produced_by)?.span_attributes.type).toBe("llm");
      if (voice.interrupted_by)
        expect(
          speechSpan.parse(byId.get(voice.interrupted_by)).metadata[
            "voice.speech"
          ].speaker,
        ).toBe("user");
      for (const selection of span.metadata["audio.selections"] ?? []) {
        expect(byId.has(selection.recording_span_id)).toBe(true);
        expect(selection.channel_index).toBe(voice.speaker === "user" ? 0 : 1);
      }
    }
  });

  test("speech span times match their audio selections", () => {
    const [recording] = z
      .array(z.object({ timeline: z.object({ origin_unix_ms: z.number() }) }))
      .parse(
        rows.find((row) => row.span_parents === null)?.metadata?.[
          "audio.recordings"
        ],
      );
    const origin = recording.timeline.origin_unix_ms;
    for (const span of speech) {
      const [selection] = span.metadata["audio.selections"] ?? [];
      expect(span.metrics.start * 1000 - origin).toBeCloseTo(
        selection.start_offset_ms,
      );
      expect(span.metrics.end * 1000 - origin).toBeCloseTo(
        selection.end_offset_ms,
      );
    }
  });
});
