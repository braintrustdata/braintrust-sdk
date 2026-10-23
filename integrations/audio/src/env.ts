import type { AudioMiddleware } from "braintrust";
import { ogg } from "./ogg";
import { opus, warmOpus } from "./opus";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Each layer has its own segment types.
type AnyAudioMiddleware = AudioMiddleware<any, any>;

/** Middleware that can be named in BRAINTRUST_AUDIO_MIDDLEWARE, with default settings. */
const KNOWN: Record<string, () => AnyAudioMiddleware> = {
  opus: () => opus(),
  ogg: () => ogg(),
};
/** What BRAINTRUST_AUDIO_COMPRESSION enables. */
const COMPRESSION = ["opus", "ogg"];

/**
 * Builds a per-recording middleware factory from BRAINTRUST_AUDIO_MIDDLEWARE
 * (comma-separated names, in order) or BRAINTRUST_AUDIO_COMPRESSION. Returns
 * undefined when neither asks for middleware; throws on unknown names.
 */
export function middlewareFromEnv(
  env: Record<string, string | undefined>,
): (() => AnyAudioMiddleware[]) | undefined {
  const list = env.BRAINTRUST_AUDIO_MIDDLEWARE?.trim();
  const compression = ["1", "true"].includes(
    env.BRAINTRUST_AUDIO_COMPRESSION?.trim().toLowerCase() ?? "",
  );
  const names = list
    ? list
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
    : compression
      ? COMPRESSION
      : undefined;
  if (!names?.length) return;
  for (const name of names)
    if (!Object.hasOwn(KNOWN, name))
      throw new Error(
        `Unknown audio middleware "${name}" in BRAINTRUST_AUDIO_MIDDLEWARE (known: ${Object.keys(KNOWN).join(", ")})`,
      );
  // Compile the codec now so the first recording does not.
  if (names.includes("opus")) warmOpus().catch(() => {});
  return () => names.map((name) => KNOWN[name]());
}
