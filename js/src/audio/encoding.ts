import { createRequire } from "node:module";
import { join } from "node:path";
import { debugLogger } from "../debug-logger";

type Codec = { module: string };

/** Resolve the optional codec only when a recording is created. */
export function resolveEncoder(
  format?: "wav" | "ogg",
  load: () => { oggOpus(): Codec } = () =>
    createRequire(join(process.cwd(), "package.json"))(
      "@braintrust/audio-utils",
    ),
): Codec | undefined {
  if (format === "wav") return undefined;
  try {
    return load().oggOpus();
  } catch {
    if (format === "ogg")
      debugLogger.warn(
        "Ogg recording requires @braintrust/audio-utils; using WAV.",
      );
    return undefined;
  }
}
