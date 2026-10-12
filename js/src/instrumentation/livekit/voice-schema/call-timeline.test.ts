import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { timelineRowMetadataSchema, type VoiceEvent } from "./call-timeline";

const examples = path.resolve(
  __dirname,
  "../../../../../docs/voice-schema/call-timeline/examples",
);

function events(file: string): VoiceEvent[] {
  const rows: { metadata?: Record<string, unknown> }[] = JSON.parse(
    readFileSync(path.join(examples, file), "utf8"),
  );
  return rows
    .filter((row) => row.metadata?.["voice.timeline"] !== undefined)
    .map((row) => timelineRowMetadataSchema.parse(row.metadata))
    .sort(
      (a, b) =>
        a["voice.timeline"].chunk_index - b["voice.timeline"].chunk_index,
    )
    .flatMap((chunk) => chunk["voice.events"]);
}

describe.each(["cascaded.json", "realtime.json"])("%s", (file) => {
  it("parses as a gapless, time-ordered event log", () => {
    const log = events(file);
    expect(log.map((event) => event.seq)).toEqual(log.map((_, i) => i));
    for (let i = 1; i < log.length; i++)
      expect(log[i].at_ms).toBeGreaterThanOrEqual(log[i - 1].at_ms);
    expect(log.at(-1)?.kind).toBe("call_end");
  });

  it("pairs every speech start with an end", () => {
    const log = events(file);
    const open = new Set<string>();
    for (const event of log) {
      if (event.kind === "speech_start") open.add(event.utterance_id);
      if (event.kind === "speech_end") open.delete(event.utterance_id);
    }
    expect([...open]).toEqual([]);
  });
});
