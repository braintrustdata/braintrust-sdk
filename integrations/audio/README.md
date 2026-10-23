# @braintrust/audio

Provides audio pipeline middleware for transforming observed audio.

Supports: `opus()`, `ogg()`

## Installation

```sh
npm install @braintrust/audio
```

Requires Node 20+ and `braintrust` 3.40+.

## Usage

Each middleware receives a recorded segment, its metadata, and `next`, which runs the rest of the stack:

```ts
import { ogg, opus } from "@braintrust/audio";

// One segment of 24 kHz stereo PCM, as a recorder emits it.
const pcm = new Uint8Array(24000 * 2 * 2); // 1 s of silence
const meta = {
  index: 0,
  startOffsetMs: 0,
  durationMs: 1000,
  sampleRate: 24000,
  channelCount: 2,
  sources: [
    { channel: 0, name: "input" },
    { channel: 1, name: "output" },
  ],
  mimeType: "audio/pcm",
  encoding: "s16le",
};

const result = await opus()(pcm, meta, async (packets, packetMeta) =>
  ogg()(packets, packetMeta, async (segment, meta) => ({ segment, meta })),
);
result.meta.mimeType; // "audio/ogg"
result.segment; // Uint8Array of a complete .ogg file
```

Middleware can be plugged directly into Braintrust SDK instrumentation that supports the audio pipeline, e.g.:

```ts
import { configureInstrumentation } from "braintrust/instrumentation";
import { ogg, opus } from "@braintrust/audio";

configureInstrumentation({
  integrations: {
    livekit: { audioMiddleware: () => [opus(), ogg()] },
  },
});
```

### From environment variables

With auto-instrumentation, enable compression without code. Install the package, then:

```sh
BRAINTRUST_AUDIO_COMPRESSION=true node --import braintrust/hook.mjs agent.js
```

| Variable                       | Example    | Behavior                                                             |
| ------------------------------ | ---------- | -------------------------------------------------------------------- |
| `BRAINTRUST_AUDIO_COMPRESSION` | `true`     | Equivalent to `BRAINTRUST_AUDIO_MIDDLEWARE=opus,ogg`.                |
| `BRAINTRUST_AUDIO_MIDDLEWARE`  | `opus,ogg` | Middleware stack to apply. Overrides `BRAINTRUST_AUDIO_COMPRESSION`. |

Middleware configured in code takes precedence over these variables. If the package is missing or a name is unknown, recordings stay raw PCM and a warning is logged.

## Options

`opus()` accepts encoder settings:

```ts
opus({ bitrate: 32, application: "voip" });
```

| Option        | Default   | Meaning                                               |
| ------------- | --------- | ----------------------------------------------------- |
| `bitrate`     | `64`      | Target bitrate in kbps.                               |
| `complexity`  | `5`       | Encoder effort, from 0 (fastest) to 10.               |
| `application` | `"audio"` | Encoder tuning: `"audio"`, `"voip"`, or `"lowdelay"`. |

Encoding runs on the main thread in 20 ms frames and yields to the event loop after each second of audio.

## Writing middleware

Middleware are functions that receive a segment, its metadata, and `next`, which runs the rest of the stack. Types are exported for custom encoders and containers:

```ts
import type { AudioMiddleware } from "braintrust";
import type { EncodedPackets } from "@braintrust/audio";

const logSize: AudioMiddleware<EncodedPackets> = async (
  packets,
  meta,
  next,
) => {
  console.log(`${packets.packets.length} ${packets.codec} packets`);
  return next(packets, meta);
};

// audioMiddleware: () => [opus(), logSize, ogg()]
```
