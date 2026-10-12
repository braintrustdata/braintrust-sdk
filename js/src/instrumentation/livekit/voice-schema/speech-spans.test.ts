import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod/v3";
import { speechSpan, voiceCall, voiceSpeech } from "./speech-spans";

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

  const call = rows.find((row) => row.span_parents === null);
  const callInfo = voiceCall.parse(call?.metadata?.["voice.call"]);

  test("the call span declares its pipeline and clock", () => {
    expect(callInfo.pipeline).toBe(name);
    const [recording] = z
      .array(z.object({ timeline: z.object({ origin_unix_ms: z.number() }) }))
      .parse(call?.metadata?.["audio.recordings"]);
    expect(recording.timeline.origin_unix_ms).toBe(callInfo.origin_unix_ms);
  });

  test("speech links resolve to spans of the right kind", () => {
    expect(speech).toHaveLength(5);
    for (const span of speech) {
      const voice = span.metadata["voice.speech"];
      expect(span.span_parents).toEqual([voice.turn_id ?? call?.span_id]);
      if (voice.state === "ignored") expect(voice.turn_id).toBeUndefined();
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

  test("speech spans run from the first to the last audio fragment", () => {
    for (const span of speech) {
      const selections = span.metadata["audio.selections"] ?? [];
      expect(span.metrics.start * 1000 - callInfo.origin_unix_ms).toBeCloseTo(
        selections[0].start_offset_ms,
      );
      expect(span.metrics.end * 1000 - callInfo.origin_unix_ms).toBeCloseTo(
        selections[selections.length - 1].end_offset_ms,
      );
    }
    expect(
      speech.find((span) => span.span_id === "s1")?.metadata[
        "audio.selections"
      ],
    ).toHaveLength(name === "cascaded" ? 2 : 1);
  });
});

test("speech without audio cannot claim audio sample timing", () => {
  const span = {
    span_id: "s",
    span_parents: ["call"],
    span_attributes: { name: "speech", type: "task" },
    metrics: { start: 1, end: 2 },
    metadata: {
      "voice.speech": {
        speaker: "user",
        state: "ignored",
        timing_source: "audio_samples",
      },
    },
  };
  expect(speechSpan.safeParse(span).success).toBe(false);
  span.metadata["voice.speech"].timing_source = "vad";
  expect(speechSpan.safeParse(span).success).toBe(true);
});

test("agent speech that played nothing is not a speech span", () => {
  expect(
    voiceSpeech.safeParse({
      speaker: "agent",
      state: "interrupted",
      timing_source: "playout",
      played_ms: 0,
    }).success,
  ).toBe(false);
});

test("agent spoken text must come from playout-synchronized text", () => {
  const span = {
    span_id: "s",
    span_parents: ["t"],
    span_attributes: { name: "speech", type: "task" },
    metrics: { start: 1, end: 2 },
    output: { text: "I have", planned_text: "I have nine thirty." },
    metadata: {
      "voice.speech": {
        speaker: "agent",
        turn_id: "t",
        state: "interrupted",
        timing_source: "playout",
        played_ms: 500,
        transcript: { source: "model_output", final: true },
      },
    },
  };
  expect(speechSpan.safeParse(span).success).toBe(false);
  const { text: _text, ...planned } = span.output;
  expect(speechSpan.safeParse({ ...span, output: planned }).success).toBe(true);
});
