import { expect, test, vi } from "vitest";
import { createAudioRecording } from "./index";

test("public recording API exports PCM only after upload succeeds", async () => {
  const log = vi.fn();
  const flush = vi.fn(async () => {});
  let complete!: () => void;
  let started!: () => void;
  const uploading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const uploaded = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const createAttachment = vi.fn(
    (options: { data: Uint8Array; filename: string; contentType: string }) => ({
      reference: {
        key: "uploaded",
        filename: options.filename,
        content_type: options.contentType,
      },
      upload: async () => {
        started();
        await uploaded;
        return { upload_status: "done" };
      },
    }),
  );
  const recording = createAudioRecording({
    // Explicit undefined must behave like an omitted optional setting.
    options: {
      segmentDurationSeconds: undefined,
      maxDurationSeconds: undefined,
      maxBufferBytes: undefined,
      flushFraction: undefined,
    },
    span: { spanId: "call", log },
    flush,
    createAttachment,
    snapshot: () => ({
      origin: 1234,
      basis: "test",

      source: (channel_index) => ({ channel_index }),
    }),
  });
  recording.record({
    pcm: new Int16Array(480).fill(1000),
    at: 0,
    rate: 24000,
    channels: 1,
    channel: 0,
  });
  const finishing = recording.finish();
  try {
    await uploading;
    recording.publishRecordings();
    expect(
      log.mock.calls
        .flatMap(([row]) => row.metadata?.["audio.recordings"] ?? [])
        .every((r) => r.state === "pending"),
    ).toBe(true);
    expect(log.mock.calls.some(([row]) => row.input?.audio)).toBe(false);
    const file = createAttachment.mock.calls[0][0];
    expect(file).toMatchObject({
      filename: "call-0000.pcm",
      contentType: "audio/pcm",
    });
    // 20ms of headerless stereo frames, with the source on the left channel.
    expect(file.data.byteLength).toBe(480 * 4);
    expect(Buffer.from(file.data).readInt16LE(0)).toBe(1000);
    expect(Buffer.from(file.data).readInt16LE(2)).toBe(0);
    complete();
    await finishing;
    expect(
      log.mock.calls
        .flatMap(([row]) => row.metadata?.["audio.recordings"] ?? [])
        .at(-1),
    ).toMatchObject({
      state: "ready",
      mime_type: "audio/pcm",
      sample_rate_hz: 24000,
      channel_count: 2,
    });
    expect(flush).toHaveBeenCalled();
  } finally {
    complete();
    await finishing;
  }
});

test("staged audio is copied, can be discarded, and is bounded independently per recording", async () => {
  const source = new Int16Array(12 * 1024 * 1024);
  source[0] = 123;
  const recordings = Array.from({ length: 3 }, () =>
    createAudioRecording({
      options: { maxBufferBytes: source.byteLength },
      span: { spanId: "session", log: () => {} },
      flush: async () => {},
      createAttachment: () => {
        throw new Error("Discarded audio must not upload");
      },
      snapshot: () => ({
        origin: 0,
        basis: "test",

        source: () => ({}),
      }),
    }),
  );
  try {
    // More than 64 MiB in aggregate must not trigger a hidden cross-session limit.
    const staged = recordings.map((recording) => recording.copy(source));
    expect(staged.every((pcm) => pcm?.[0] === 123)).toBe(true);
    source[0] = 456;
    for (const [index, recording] of recordings.entries()) {
      expect(staged[index]?.[0]).toBe(123);
      recording.release(staged[index]!);
    }
    // Discarding returns capacity; exceeding this recording's own limit stops capture.
    expect(recordings[0].copy(source)).toBeDefined();
    expect(recordings[0].copy(new Int16Array(1))).toBeUndefined();
    expect(recordings[0].reason).toBe("capture_byte_limit");
    expect(recordings[1].copy(new Int16Array(1))).toBeDefined();
    expect(recordings[1].reason).toBeUndefined();
  } finally {
    await Promise.all(recordings.map((recording) => recording.finish()));
  }
});

test("recording publication observes changed context and suppresses identical updates", async () => {
  const log = vi.fn();
  const metadata = { source: "microphone" };
  const recording = createAudioRecording({
    span: { spanId: "session", log },
    flush: async () => {},
    createAttachment: () => {
      throw new Error("No audio captured");
    },
    snapshot: () => ({
      origin: 0,
      basis: "test",

      source: () => ({}),
      metadata,
    }),
  });
  recording.publishRecordings();
  recording.publishRecordings();
  expect(log).toHaveBeenCalledTimes(1);
  metadata.source = "replacement";
  recording.publishRecordings();
  expect(log).toHaveBeenCalledTimes(2);
  expect(log.mock.calls.at(-1)?.[0].metadata.source).toBe("replacement");
  await recording.finish();
});

test.each([undefined, "capture_byte_limit"])(
  "finish publishes final state without audio (reason=%s) and is idempotent",
  async (reason) => {
    const log = vi.fn();
    const flush = vi.fn(async () => {});
    const recording = createAudioRecording({
      span: { spanId: "session", log },
      flush,
      createAttachment: () => {
        throw new Error("No audio to upload");
      },
      snapshot: () => ({ origin: 0, basis: "test", source: () => ({}) }),
    });
    recording.publishRecordings();
    if (reason) {
      recording.stop(reason);
    }
    await recording.finish();
    expect(
      log.mock.calls.at(-1)?.[0].metadata["audio.recordings"],
    ).toMatchObject([
      { state: "omitted", reason: reason ?? "no_audio_observed" },
    ]);
    const count = log.mock.calls.length;
    await recording.finish();
    expect(log).toHaveBeenCalledTimes(count);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(recording.copy(new Int16Array(1))).toBeUndefined();
  },
);
