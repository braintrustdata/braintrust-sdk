import { expect, test } from "vitest";
import { encodePcm } from "./pcm";
import type { Packet } from "./segment";

function frames(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / 4 }, (_, i) => [
    view.getInt16(i * 4, true),
    view.getInt16(i * 4 + 2, true),
  ]);
}

test("renders headerless 24kHz stereo PCM for the requested duration", () => {
  const result = encodePcm(
    [
      {
        pcm: new Int16Array(240).fill(1),
        rate: 24000,
        channels: 1,
        channel: 0,
        at: 0,
      },
    ],
    20,
  );
  expect(result).toMatchObject({
    mimeType: "audio/pcm",
    sampleRate: 24000,
    durationMs: 20,
  });
  expect(result.bytes.byteLength).toBe(480 * 4);
  expect(frames(result.bytes).slice(238, 242)).toEqual([
    [1, 0],
    [1, 0],
    [0, 0],
    [0, 0],
  ]);
});

test("resampling interpolates linearly from each packet's offset and pads the timeline", () => {
  const source = Int16Array.from(
    { length: 12000 },
    (_, i) => (i % 97) * 100 - 4000,
  );
  const actual = frames(
    encodePcm(
      [{ pcm: source, rate: 44100, channels: 1, channel: 1, at: 7.3 }],
      400,
    ).bytes,
  );
  expect(actual).toHaveLength(9600);
  const start = Math.round((7.3 * 24000) / 1000),
    length = Math.round((source.length / 44100) * 24000);
  for (const [i, [left, right]] of actual.entries()) {
    const position = ((i - start) * 44100) / 24000,
      lo = Math.floor(position),
      alpha = position - lo;
    const expected =
      i < start || i >= start + length
        ? 0
        : Math.round(
            source[Math.min(lo, source.length - 1)] * (1 - alpha) +
              source[Math.min(lo + 1, source.length - 1)] * alpha,
          );
    expect(left).toBe(0);
    expect(right).toBe(expected);
  }
});

test("rendering preserves packet overwrite order, channel separation and silence", () => {
  const packets: Packet[] = [
    {
      pcm: new Int16Array(4800).fill(123),
      rate: 24000,
      channels: 1,
      channel: 0,
      at: 50,
    },
    {
      pcm: new Int16Array(4800).fill(456),
      rate: 24000,
      channels: 1,
      channel: 1,
      at: 0,
    },
    {
      pcm: new Int16Array(4800).fill(789),
      rate: 24000,
      channels: 1,
      channel: 0,
      at: 0,
    },
  ];
  for (const [i, [left, right]] of frames(
    encodePcm(packets, 300).bytes,
  ).entries()) {
    expect(left).toBe(i < 4800 ? 789 : i < 6000 ? 123 : 0);
    expect(right).toBe(i < 4800 ? 456 : 0);
  }
});

test("mixed source rates retain channel values and infer duration", () => {
  const result = encodePcm([
    {
      pcm: new Int16Array(160).fill(1000),
      rate: 8000,
      channels: 1,
      channel: 0,
      at: 0,
    },
    {
      pcm: new Int16Array(960).fill(-1000),
      rate: 48000,
      channels: 1,
      channel: 1,
      at: 0,
    },
  ]);
  expect(result.durationMs).toBe(20);
  expect(new Set(frames(result.bytes).map(String))).toEqual(
    new Set(["1000,-1000"]),
  );
});

test("stereo sources are averaged onto their channel", () => {
  const result = encodePcm([
    {
      pcm: Int16Array.of(100, 300, 1000, -1000),
      rate: 24000,
      channels: 2,
      channel: 1,
      at: 0,
    },
  ]);
  expect(frames(result.bytes)).toEqual([
    [0, 200],
    [0, 0],
  ]);
});

test.each([
  [[], undefined, "invalid_duration"],
  [[], 1800001, "invalid_duration"],
  [
    [{ pcm: new Int16Array(1), rate: 24000, channels: 1, channel: 2, at: 0 }],
    20,
    "invalid_packet",
  ],
  [
    [{ pcm: new Int16Array(1), rate: 4000, channels: 1, channel: 0, at: 0 }],
    20,
    "invalid_packet",
  ],
] as [Packet[], number | undefined, string][])(
  "rejects unsupported input (%#)",
  (packets, durationMs, reason) => {
    expect(() => encodePcm(packets, durationMs)).toThrow(reason);
  },
);
