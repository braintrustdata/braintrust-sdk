# Recording utilities for SDK integrations

Internal Node utilities shared by voice integrations. Audio recording buffers timestamped PCM, rotates bounded segments, produces WAV files in a worker, and uploads attachments. Voice recording adds associations between speech spans and audio files.

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
