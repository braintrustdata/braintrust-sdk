# Braintrust audio compression

Optional Ogg/Opus encoding for SDK recordings. Requires Node 20+.

```sh
npm install braintrust @braintrust/audio-utils
```

With recording enabled, the SDK uses compressed Ogg when this package is installed. Without it, recordings use WAV. Installing this package does not enable recording.

```ts
import { configureInstrumentation } from "braintrust";

configureInstrumentation({
  integrations: { livekit: { captureAudio: true } },
});

// Select uncompressed recording explicitly:
configureInstrumentation({
  integrations: { livekit: { captureAudio: true, audioFormat: "wav" } },
});
```

The package supplies `oggOpus()`, an encoder descriptor loaded by the SDK's audio worker. It contains no recording, buffering, upload, or LiveKit logic.

```sh
pnpm build
pnpm check:typings
pnpm test
```
