import { msToSamples, samplesToMs, CALL_SAMPLE_RATE } from "./timeline";
import type { EncodedAudio, Packet } from "./segment";
/**
 * Render a bounded call timeline as raw PCM: interleaved stereo, signed 16-bit
 * little-endian at 24kHz. Each packet is resampled onto its channel; gaps are
 * silence and later packets overwrite earlier overlapping audio.
 */
export function encodePcm(
  packets: Packet[],
  durationMs?: number,
): EncodedAudio {
  const rate = CALL_SAMPLE_RATE;
  const samples =
    durationMs === undefined
      ? Math.ceil(
          packets.reduce(
            (end, p) =>
              Math.max(
                end,
                msToSamples(p.at, rate) +
                  (p.pcm.length / p.channels / p.rate) * rate,
              ),
            0,
          ),
        )
      : Math.round(msToSamples(durationMs, rate));
  if (!Number.isSafeInteger(samples) || samples <= 0 || samples > 1800 * rate) {
    throw new Error("invalid_duration");
  }
  const bytes = new Uint8Array(samples * 4);
  const view = new DataView(bytes.buffer);
  for (const p of packets) {
    if (
      ![0, 1].includes(p.channel) ||
      ![1, 2].includes(p.channels) ||
      !Number.isFinite(p.rate) ||
      p.rate < 8000 ||
      p.rate > 96000 ||
      !Number.isFinite(p.at) ||
      p.at < 0
    ) {
      throw new Error("invalid_packet");
    }
    const start = Math.round(msToSamples(p.at, rate));
    const end = Math.min(
      samples,
      start + Math.round((p.pcm.length / p.channels / p.rate) * rate),
    );
    for (let i = start; i < end; i++) {
      // Linear interpolation, averaging interleaved source channels to mono.
      const position = ((i - start) * p.rate) / rate,
        lo = Math.floor(position),
        alpha = position - lo;
      let value = 0;
      for (let channel = 0; channel < p.channels; channel++) {
        const a =
          p.pcm[Math.min(lo * p.channels + channel, p.pcm.length - 1)] ?? 0;
        const b =
          p.pcm[Math.min((lo + 1) * p.channels + channel, p.pcm.length - 1)] ??
          a;
        value += a + (b - a) * alpha;
      }
      view.setInt16(
        (i * 2 + p.channel) * 2,
        Math.max(-32768, Math.min(32767, Math.round(value / p.channels))),
        true,
      );
    }
  }
  return {
    bytes,
    durationMs: samplesToMs(samples, rate),
    mimeType: "audio/pcm",
    sampleRate: rate,
  };
}
