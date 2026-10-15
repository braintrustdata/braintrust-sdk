import { expect } from "vitest";
import type { CapturedLogEvent } from "../../helpers/mock-braintrust-server";
import { findAllSpans } from "../../helpers/trace-selectors";

type Selection = {
  recording_span_id: string;
  recording_id: string;
  channel_index: number;
  start_offset_ms: number;
  end_offset_ms: number;
};
type Recording = {
  id: string;
  state: string;
  duration_ms: number;
  sample_rate_hz: number;
  channel_count: number;
  timeline: { origin_unix_ms: number; recording_start_offset_ms: number };
  attachment?: { span_id: string; ref: string };
};

export function assertAudioTrace(
  raw: CapturedLogEvent[],
  {
    unassociatedSpeaking = [],
  }: { unassociatedSpeaking?: readonly string[] } = {},
) {
  const events = [...new Set(raw.map((e) => e.span.name))].flatMap((name) =>
    findAllSpans(raw, name!),
  );
  const recordings = new Map<string, Recording>();
  const key = (spanId: string, id: string) => JSON.stringify([spanId, id]);
  for (const event of events) {
    for (const r of (event.metadata?.["audio.recordings"] ??
      []) as Recording[]) {
      expect(recordings.has(key(event.span.id!, r.id))).toBe(false);
      recordings.set(key(event.span.id!, r.id), r);
      if ("gaps" in r) expect(r.timeline).toBeDefined();
      if (r.state !== "ready") continue;
      expect(Number.isFinite(r.duration_ms)).toBe(true);
      expect(r.duration_ms).toBeGreaterThan(0);
      expect(r.sample_rate_hz).toBeGreaterThan(0);
      expect(r.channel_count).toBeGreaterThan(0);
      expect(Number.isFinite(r.timeline.origin_unix_ms)).toBe(true);
      expect(r.timeline.recording_start_offset_ms).toBeGreaterThanOrEqual(0);
      expect(r.attachment).toBeDefined();
      const owner = events.find((e) => e.span.id === r.attachment!.span_id);
      expect(owner).toBeDefined();
      // Attachment references are JSON pointers into the owning row.
      const attachment = r
        .attachment!.ref.split("/")
        .slice(1)
        .reduce<unknown>(
          (value, part) =>
            (value as Record<string, unknown>)?.[
              part.replace(/~1/g, "/").replace(/~0/g, "~")
            ],
          owner!.row,
        );
      expect(attachment).toMatchObject({ type: "braintrust_attachment" });
    }
  }
  for (const event of events) {
    for (const s of (event.metadata?.["audio.selections"] ??
      []) as Selection[]) {
      const r = recordings.get(key(s.recording_span_id, s.recording_id));
      expect(r, `${event.span.name}: unknown recording`).toBeDefined();
      expect(r!.state).toBe("ready");
      expect(Number.isInteger(s.channel_index)).toBe(true);
      expect(s.channel_index).toBeGreaterThanOrEqual(0);
      expect(s.channel_index).toBeLessThan(r!.channel_count);
      if (["user_turn", "user_speech"].includes(event.span.name!))
        expect(s.channel_index).toBe(0);
      if (["agent_turn", "agent_speech"].includes(event.span.name!))
        expect(s.channel_index).toBe(1);
      expect(
        Number.isFinite(s.start_offset_ms) && Number.isFinite(s.end_offset_ms),
      ).toBe(true);
      expect(s.start_offset_ms).toBeGreaterThanOrEqual(0);
      expect(s.end_offset_ms).toBeGreaterThan(s.start_offset_ms);
      expect(s.end_offset_ms).toBeLessThanOrEqual(
        r!.duration_ms + 1000 / r!.sample_rate_hz,
      );
    }
  }
  const unassociated = new Set(unassociatedSpeaking);
  for (const speech of events.filter((e) =>
    ["user_speech", "agent_speech"].includes(e.span.name!),
  )) {
    const turnId = speech.metadata?.["turn.id"];
    if (turnId === undefined) {
      unassociated.delete(speech.span.id!);
      const parent = events.find((e) => e.span.id === speech.span.parentIds[0]);
      expect(parent?.span.name).toBe("livekit.agent_session");
      continue;
    }
    const turn = events.find((e) => e.span.id === turnId);
    expect(
      turn,
      `${speech.span.name}: missing or dangling turn.id`,
    ).toBeDefined();
    expect(turn!.span.name).toBe(
      speech.span.name === "user_speech" ? "user_turn" : "agent_turn",
    );
    expect(speech.row.span_parents).toEqual([turnId]);
  }
  expect(
    [...unassociated],
    "expected unassociated speaking spans were not found",
  ).toEqual([]);
  for (const source of events) {
    for (const link of (source.row.links ?? []) as {
      context: { traceId: string; spanId: string; traceFlags: number };
      attributes: Record<string, string>;
    }[]) {
      expect(link.context.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(link.context.spanId).toMatch(/^[0-9a-f]{16}$/);
      const target = events.find(
        (event) => event.span.id === link.context.spanId,
      );
      expect(target, "link target must be an exported span").toBeDefined();
      expect(target!.row.root_span_id).toBe(link.context.traceId);
      expect([
        "input_context",
        "requested_by",
        "consumes_tool_result",
        "generated_by",
        "transcribed_by",
      ]).toContain(link.attributes["braintrust.relationship.type"]);
    }
  }
}
