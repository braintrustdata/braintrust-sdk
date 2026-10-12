import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  callSpanMetadataSchema,
  timelineRowMetadataSchema,
  type VoiceEvent,
} from "./call-timeline";

const examples = path.resolve(
  __dirname,
  "../../../../../docs/voice-schema/call-timeline/examples",
);

type Row = {
  span_id: string;
  span_parents: string[];
  metadata?: Record<string, unknown>;
};

function rows(file: string): Row[] {
  return JSON.parse(readFileSync(path.join(examples, file), "utf8"));
}

function events(file: string): VoiceEvent[] {
  return rows(file)
    .filter((row) => row.metadata?.["voice.timeline"] !== undefined)
    .map((row) => timelineRowMetadataSchema.parse(row.metadata))
    .sort(
      (a, b) =>
        a["voice.timeline"].chunk_index - b["voice.timeline"].chunk_index,
    )
    .flatMap((chunk) => chunk["voice.events"]);
}

describe.each(["cascaded.json", "realtime.json"])("%s", (file) => {
  it("versions the call span", () => {
    const call = rows(file).find((row) => row.span_parents.length === 0);
    expect(callSpanMetadataSchema.parse(call?.metadata)).toMatchObject({
      "voice.timeline_version": 1,
    });
  });

  it("numbers events in emission order and ends with call_end", () => {
    const log = events(file);
    expect(log.map((event) => event.seq)).toEqual(log.map((_, i) => i));
    expect(log.at(-1)?.kind).toBe("call_end");
  });

  it("pairs every speech start with an end", () => {
    const open = new Set<string>();
    for (const event of events(file)) {
      if (event.kind === "speech_start") open.add(event.utterance_id);
      if (event.kind === "speech_end") open.delete(event.utterance_id);
    }
    expect([...open]).toEqual([]);
  });

  it("refers only to utterances that started", () => {
    const log = events(file);
    const started = new Set(
      log.flatMap((event) =>
        event.kind === "speech_start" ? [event.utterance_id] : [],
      ),
    );
    const referenced = log.flatMap((event) =>
      event.kind === "end_of_turn" || event.kind === "message"
        ? event.utterance_ids
        : "utterance_id" in event && event.utterance_id !== undefined
          ? [event.utterance_id]
          : [],
    );
    expect(referenced.filter((id) => !started.has(id))).toEqual([]);
  });

  it("maps every committed caller utterance to a message", () => {
    const log = events(file);
    const mapped = new Set(
      log.flatMap((event) =>
        event.kind === "message" && event.speaker === "user"
          ? event.utterance_ids
          : [],
      ),
    );
    const committed = log.flatMap((event) =>
      event.kind === "end_of_turn" ? event.utterance_ids : [],
    );
    expect(committed.filter((id) => !mapped.has(id))).toEqual([]);
  });
});
