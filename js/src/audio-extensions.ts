import type { AudioMiddlewareStack } from "./audio-middleware";
import { debugLogger } from "./debug-logger";
import iso from "./isomorph";
import { isObject } from "../util";
import { isEnvFlagEnabled } from "./wrappers/attachment-utils";

/** Set by @braintrust/audio when it is imported. */
const REGISTRY = Symbol.for("braintrust.audio");
// A variable, so bundlers leave this optional package to be resolved at runtime.
const AUDIO_PACKAGE = "@braintrust/audio";
const MIDDLEWARE_ENV = "BRAINTRUST_AUDIO_MIDDLEWARE";
const COMPRESSION_ENV = "BRAINTRUST_AUDIO_COMPRESSION";

type AudioExtension = {
  version: 1;
  middlewareFromEnv(
    env: Record<string, string | undefined>,
  ): (() => AudioMiddlewareStack) | undefined;
};

/**
 * Starts loading the middleware that BRAINTRUST_AUDIO_MIDDLEWARE or
 * BRAINTRUST_AUDIO_COMPRESSION asks for, without waiting. Returns a factory of
 * each recording's stack, or undefined when neither asks for middleware.
 * Never throws: problems are reported once and recordings stay raw PCM.
 */
export function loadAudioMiddlewareFromEnv():
  | (() => Promise<AudioMiddlewareStack>)
  | undefined {
  const env = {
    [MIDDLEWARE_ENV]: iso.getEnv(MIDDLEWARE_ENV),
    [COMPRESSION_ENV]: iso.getEnv(COMPRESSION_ENV),
  };
  const setting = env[MIDDLEWARE_ENV]?.trim()
    ? MIDDLEWARE_ENV
    : isEnvFlagEnabled(COMPRESSION_ENV)
      ? COMPRESSION_ENV
      : undefined;
  if (!setting) return;
  const loading = resolve(env, setting);
  return async () => {
    try {
      return (await loading)?.() ?? [];
    } catch (error) {
      return rawPcm(error) ?? [];
    }
  };
}

async function resolve(
  env: Record<string, string | undefined>,
  setting: string,
) {
  try {
    if (registered() === undefined) {
      try {
        await import(
          /* webpackIgnore: true */ /* @vite-ignore */ AUDIO_PACKAGE
        );
      } catch {
        const feature =
          setting === COMPRESSION_ENV
            ? "Audio compression"
            : "Audio middleware";
        return warn(
          `${feature} is enabled (${setting}), but ${AUDIO_PACKAGE} could not be loaded. Recording raw PCM. Install it with: npm install ${AUDIO_PACKAGE}`,
        );
      }
    }
    const extension = registered();
    if (!isAudioExtension(extension))
      return warn(
        `${AUDIO_PACKAGE} is incompatible with this braintrust version. Recording raw PCM.`,
      );
    return extension.middlewareFromEnv(env);
  } catch (error) {
    return rawPcm(error);
  }
}

function rawPcm(error: unknown): undefined {
  return warn(
    `${error instanceof Error ? error.message : String(error)}. Recording raw PCM.`,
  );
}

function registered(): unknown {
  return Reflect.get(globalThis, REGISTRY);
}

function isAudioExtension(value: unknown): value is AudioExtension {
  return (
    isObject(value) &&
    value.version === 1 &&
    typeof value.middlewareFromEnv === "function"
  );
}

function warn(message: string): undefined {
  debugLogger.notice.warn(message);
  return undefined;
}
