import { expect, test, vi } from "vitest";
import {
  createVoiceRecording,
  type AudioRecordingConfig,
  type Selection,
} from "./index";

test.each(["pending", "attachment", "manifest", "selection", "flush"])(
  "%s publication failure preserves uploaded audio and subsequent capture",
  async (failure) => {
    const rows: Parameters<AudioRecordingConfig["span"]["log"]>[0][] = [];
    const audioKeys = (row: (typeof rows)[number]) =>
      row.input && typeof row.input === "object" && "audio" in row.input
        ? Object.keys(row.input.audio as object)
        : [];
    let fail = true;
    const rejectOnce = (stage: string) => {
      if (stage === failure && fail) {
        fail = false;
        throw new Error("temporary trace failure");
      }
    };
    const log = (row: (typeof rows)[number]) => {
      if (audioKeys(row).length) {
        rejectOnce("attachment");
      }
      const manifest = row.metadata?.["audio.recordings"];
      if (Array.isArray(manifest)) {
        const ready = manifest.some(
          (s: { state: string }) => s.state === "ready",
        );
        rejectOnce(ready ? "manifest" : "pending");
      }
      if (row.metadata?.["audio.selections"]) {
        rejectOnce("selection");
      }
      rows.push(row);
    };
    const turn = { log };
    const upload = vi.fn(async () => ({ upload_status: "done" }));
    const voice = createVoiceRecording({
      options: { segmentDurationSeconds: 0.02 },
      span: { spanId: "session", log },
      flush: async () => {
        // A rejected flush need not have delivered the queued trace updates.
        if (failure === "flush" && fail) {
          rows.length = 0;
        }
        rejectOnce("flush");
      },
      createAttachment: ({ filename }) => ({
        reference: { key: filename },
        upload,
      }),
      snapshot: () => ({
        origin: 0,
        basis: "test",

        source: (channel_index) => ({ channel_index }),
      }),
      speechSelections: () => [
        {
          span: turn,
          intervals: [
            {
              recording_span_id: "session",
              recording_id: "call",
              channel_index: 0,
              start_offset_ms: 0,
              end_offset_ms: 40,
            },
          ],
        },
      ],
    });
    const recording = voice.audio;
    try {
      for (const at of [0, 20]) {
        expect(
          recording.record({
            pcm: new Int16Array(480),
            at,
            rate: 24000,
            channels: 1,
            channel: 0,
          }),
        ).toBe(true);
        expect(() => recording.advance(at + 20)).not.toThrow();
        await recording.drain();
        expect(rows.flatMap(audioKeys)).toContain(
          at === 0 ? "call-0000" : "call-0001",
        );
        const selected = rows
          .filter((r) => r.metadata?.["audio.selections"])
          .at(-1);
        expect(selected?.metadata?.["audio.selections"]).toHaveLength(
          at / 20 + 1,
        );
      }
    } finally {
      await voice.finish();
    }
    recording.publishRecordings();
    voice.publishSelections();
    expect(fail).toBe(false);
    expect(upload).toHaveBeenCalledTimes(2);
    const manifest = rows
      .flatMap((r) =>
        Array.isArray(r.metadata?.["audio.recordings"])
          ? r.metadata["audio.recordings"]
          : [],
      )
      .slice(-2);
    expect(manifest).toMatchObject([{ state: "ready" }, { state: "ready" }]);
    expect(new Set(rows.flatMap(audioKeys))).toEqual(
      new Set(["call-0000", "call-0001"]),
    );
    expect(rows.at(-1)?.metadata?.["audio.selections"]).toMatchObject([
      { recording_id: "call-0000" },
      { recording_id: "call-0001" },
    ]);
  },
);

test("finish publishes late speech selections without uploading the segment again", async () => {
  const log = vi.fn();
  const turn = { log: vi.fn() };
  const upload = vi.fn(async () => ({ upload_status: "done" }));
  const intervals: Selection[] = [];
  const voice = createVoiceRecording({
    options: { segmentDurationSeconds: 0.02 },
    span: { spanId: "session", log },
    flush: async () => {},
    createAttachment: () => ({ reference: { key: "audio" }, upload }),
    snapshot: () => ({
      origin: 0,
      basis: "test",
      source: (channel_index) => ({ channel_index }),
    }),
    speechSelections: () => [{ span: turn, intervals }],
  });
  const recording = voice.audio;
  recording.record({
    pcm: new Int16Array(480),
    at: 0,
    rate: 24000,
    channels: 1,
    channel: 0,
  });
  recording.advance(20);
  await recording.drain();
  intervals.push({
    recording_span_id: "session",
    recording_id: "call",
    channel_index: 0,
    start_offset_ms: 0,
    end_offset_ms: 20,
  });
  await voice.finish();
  expect(turn.log.mock.calls.at(-1)?.[0].metadata["audio.selections"]).toEqual([
    {
      recording_span_id: "session",
      recording_id: "call-0000",
      channel_index: 0,
      start_offset_ms: 0,
      end_offset_ms: 20,
    },
  ]);
  expect(upload).toHaveBeenCalledTimes(1);
});
