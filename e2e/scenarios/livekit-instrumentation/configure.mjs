import { configureInstrumentation } from "braintrust/instrumentation";
import { ogg, opus } from "@braintrust/audio";

/** Reports each flushed segment; for Ogg files, their decoded duration too. */
const probe = async (segment, meta, next) => {
  const result = await next(segment, meta);
  const file = result.segment;
  const magic = new TextDecoder().decode(file.subarray(0, 4));
  console.log(
    JSON.stringify({
      audioMiddlewareSegment: result.meta.index,
      ...(magic === "OggS" ? { magic, decodedMs: oggDurationMs(file) } : {}),
    }),
  );
  return result;
};

/** Final granule minus the OpusHead pre-skip, at 48 kHz (RFC 7845). */
function oggDurationMs(file) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const preSkip = view.getUint16(28 + 10, true);
  let granule = 0;
  for (let at = 0; at < file.length; ) {
    granule = Number(view.getBigUint64(at + 6, true));
    const count = file[at + 26];
    at += file
      .subarray(at + 27, at + 27 + count)
      .reduce((sum, n) => sum + n, 27 + count);
  }
  return (granule - preSkip) / 48;
}

const middleware = {
  1: () => [probe],
  ogg: () => [probe, opus(), ogg()],
}[process.env.LIVEKIT_AUDIO_MIDDLEWARE ?? ""];

configureInstrumentation({
  ...(process.env.LIVEKIT_SEGMENTS === "1"
    ? { streamingAttachmentBufferBytes: 19200 } // 200 ms of 24 kHz stereo s16le.
    : {}),
  integrations: {
    livekit:
      process.env.LIVEKIT_INTEGRATION === "off"
        ? false
        : middleware
          ? { audioMiddleware: middleware }
          : true,
  },
  spanCustomizers: [
    {
      onSpanExport(data) {
        data.metadata = {
          ...data.metadata,
          scenario: "livekit-instrumentation",
          testRunId: process.env.BRAINTRUST_E2E_RUN_ID,
        };
        return data;
      },
    },
  ],
});
