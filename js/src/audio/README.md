# Recording utilities for SDK integrations

Internal utilities shared by voice integrations. Audio recording buffers timestamped PCM, rotates bounded segments, renders each segment as raw PCM, and uploads attachments. Voice recording adds associations between speech spans and audio files.

```ts
import { Attachment } from "../logger";
import { createVoiceRecording } from "./index";

const voice = createVoiceRecording({
  span: sessionSpan,
  flush: () => logger.flush(),
  createAttachment: (options) => new Attachment(options),
  options: { segmentDurationSeconds: 60 },
  snapshot: () => ({
    origin: sessionStartUnixMs,
    basis: "local_capture",
    source: (channel_index) => ({ channel_index }),
  }),
  speechSelections: () => speechSpans, // { span, intervals } in call-relative milliseconds.
});

voice.audio.record({
  pcm,
  rate: 24000,
  channels: 1,
  channel: 0,
  at: frameOffsetMs,
});
voice.audio.advance(confirmedThroughMs); // No earlier frames will arrive on either channel.
voice.publishSelections(); // Republish after speech timestamps change.
await voice.finish();
```

`createAudioRecording()` accepts the same audio configuration without `speechSelections`. Use it when no speech-to-recording associations are needed. Integrations supply timing; these utilities do not infer speech boundaries.

| Setting                          | Default    |
| -------------------------------- | ---------- |
| `options.segmentDurationSeconds` | `60`       |
| `options.maxDurationSeconds`     | `1800`     |
| `options.maxBufferBytes`         | `33554432` |
| `options.flushFraction`          | `0.5`      |

Segment duration is a rotation target, not the total recording limit. Recording starts only when the integration explicitly enables capture.

Each segment is uploaded as an `audio/pcm` attachment: headerless, interleaved stereo, signed 16-bit little-endian samples at 24kHz. Channel 0 is left and channel 1 is right; sources at other rates are resampled. The segment's `audio.recordings` descriptor carries `sample_rate_hz` and `channel_count`.
