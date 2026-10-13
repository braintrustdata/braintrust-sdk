import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  callSpanMetadataSchema,
  pointOwners,
  spanMetadataSchema,
  type VoicePoint,
} from "./span-points";

const examples = path.resolve(
  __dirname,
  "../../../../../docs/voice-schema/span-points/examples",
);

type Row = {
  span_id: string;
  span_parents: string[];
  span_attributes: { name: string; type: string };
  metadata?: Record<string, unknown>;
};

type Owned = VoicePoint & { seq: number; owner: Row };

function rows(file: string): Row[] {
  return JSON.parse(readFileSync(path.join(examples, file), "utf8"));
}

function role(row: Row): string {
  if (row.span_parents.length === 0) return "call";
  if (["user_turn", "assistant_turn"].includes(row.span_attributes.name))
    return row.span_attributes.name;
  return row.span_attributes.type;
}

function points(file: string): Owned[] {
  return rows(file)
    .flatMap((row) => {
      const metadata =
        row.span_parents.length === 0
          ? callSpanMetadataSchema.parse(row.metadata)
          : row.metadata?.["voice.points"] === undefined
            ? undefined
            : spanMetadataSchema.parse(row.metadata);
      return Object.entries(metadata?.["voice.points"] ?? {}).map(
        ([seq, point]) => ({ ...point, seq: Number(seq), owner: row }),
      );
    })
    .sort((a, b) => a.seq - b.seq);
}

describe.each(["cascaded.json", "realtime.json"])("%s", (file) => {
  it("numbers points across spans in emission order and ends with call_end", () => {
    const log = points(file);
    expect(log.map((point) => point.seq)).toEqual(log.map((_, i) => i));
    expect(log.at(-1)?.kind).toBe("call_end");
  });

  it("puts each point on a span allowed to own it", () => {
    const wrong = points(file).filter(
      (point) => !pointOwners[point.kind].includes(role(point.owner)),
    );
    expect(wrong.map((point) => point.seq)).toEqual([]);
  });

  it("keeps each utterance on one span", () => {
    const owners = new Map<string, string>();
    for (const point of points(file))
      if ("utterance_id" in point && point.utterance_id !== undefined) {
        const owner = owners.get(point.utterance_id) ?? point.owner.span_id;
        expect(point.owner.span_id).toBe(owner);
        owners.set(point.utterance_id, owner);
      }
  });

  it("pairs every speech start with an end", () => {
    const open = new Set<string>();
    for (const point of points(file)) {
      if (point.kind === "speech_start") open.add(point.utterance_id);
      if (point.kind === "speech_end") open.delete(point.utterance_id);
    }
    expect([...open]).toEqual([]);
  });

  it("names a caller utterance that overlaps the interrupted agent speech", () => {
    const log = points(file);
    const starts = new Map(
      log.flatMap((point) =>
        point.kind === "speech_start" ? [[point.utterance_id, point]] : [],
      ),
    );
    for (const point of log)
      if (point.kind === "speech_end" && point.interrupted_by !== undefined) {
        const cause = starts.get(point.interrupted_by);
        expect(cause?.speaker).toBe("user");
        expect(cause!.at_ms).toBeGreaterThanOrEqual(
          starts.get(point.utterance_id)!.at_ms,
        );
        expect(cause!.at_ms).toBeLessThanOrEqual(point.at_ms);
      }
  });
});

it("keeps sustained overlap apart from barge-in", () => {
  const log = points("cascaded.json");
  const end = (id: string) =>
    log.find(
      (point) => point.kind === "speech_end" && point.utterance_id === id,
    );
  expect(end("speech_1/0")).toMatchObject({
    interrupted: true,
    interrupted_by: "u2",
  });
  expect(end("speech_2/0")).toMatchObject({ interrupted: false });
  expect(end("speech_2/0")).not.toHaveProperty("interrupted_by");
  expect(
    log.some(
      (point) =>
        point.kind === "end_of_turn" && point.utterance_ids.includes("u3"),
    ),
  ).toBe(false);
});
