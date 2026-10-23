import { middlewareFromEnv } from "./env";

export { ogg } from "./ogg";
export { opus, type OpusOptions } from "./opus";
export type { EncodedPacket, EncodedPackets } from "./packets";

// Lets the SDK find BRAINTRUST_AUDIO_* middleware without depending on this package.
// The first copy loaded wins, so duplicate installs agree on one implementation.
(globalThis as Record<symbol, unknown>)[Symbol.for("braintrust.audio")] ??= {
  version: 1,
  middlewareFromEnv,
};
