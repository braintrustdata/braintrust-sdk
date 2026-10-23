import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadAudioMiddlewareFromEnv } from "./audio-extensions";
import type { AudioMiddleware } from "./audio-middleware";
import { configureNode } from "./node/config";

configureNode();

const REGISTRY = Symbol.for("braintrust.audio");
const registry = globalThis as Record<symbol, unknown>;
let warnings: string[];

beforeEach(() => {
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(" "));
  });
  vi.stubEnv("BRAINTRUST_AUDIO_MIDDLEWARE", "");
  vi.stubEnv("BRAINTRUST_AUDIO_COMPRESSION", "");
});
afterEach(() => {
  delete registry[REGISTRY];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const tag: AudioMiddleware = (segment, meta, next) => next(segment, meta);

test("nothing is loaded unless the env asks for middleware", () => {
  vi.stubEnv("BRAINTRUST_AUDIO_COMPRESSION", "false");
  const middlewareFromEnv = vi.fn();
  registry[REGISTRY] = { version: 1, middlewareFromEnv };
  expect(loadAudioMiddlewareFromEnv()).toBeUndefined();
  expect(middlewareFromEnv).not.toHaveBeenCalled();
});

test("a registered package builds a new stack for each recording from the audio settings", async () => {
  vi.stubEnv("BRAINTRUST_AUDIO_COMPRESSION", "true");
  vi.stubEnv("BRAINTRUST_API_KEY", "secret");
  const middlewareFromEnv = vi.fn(() => () => [tag]);
  registry[REGISTRY] = { version: 1, middlewareFromEnv };
  const factory = loadAudioMiddlewareFromEnv()!;
  expect(await factory()).toEqual([tag]);
  expect(await factory()).not.toBe(await factory());
  // Loading starts once, and the package sees only its own settings.
  expect(middlewareFromEnv).toHaveBeenCalledTimes(1);
  expect(middlewareFromEnv).toHaveBeenCalledWith({
    BRAINTRUST_AUDIO_MIDDLEWARE: "",
    BRAINTRUST_AUDIO_COMPRESSION: "true",
  });
  expect(warnings).toEqual([]);
});

test("a missing package records raw PCM and says how to install it", async () => {
  vi.stubEnv("BRAINTRUST_AUDIO_COMPRESSION", "true");
  expect(await loadAudioMiddlewareFromEnv()!()).toEqual([]);
  expect(warnings).toEqual([
    expect.stringContaining(
      "Audio compression is enabled (BRAINTRUST_AUDIO_COMPRESSION), but @braintrust/audio could not be loaded. Recording raw PCM. Install it with: npm install @braintrust/audio",
    ),
  ]);
});

test.each([
  [
    "an incompatible version",
    { version: 2, middlewareFromEnv: () => () => [tag] },
  ],
  ["no factory", { version: 1 }],
])("a package with %s records raw PCM", async (_name, extension) => {
  vi.stubEnv("BRAINTRUST_AUDIO_MIDDLEWARE", "opus,ogg");
  registry[REGISTRY] = extension;
  expect(await loadAudioMiddlewareFromEnv()!()).toEqual([]);
  expect(warnings).toEqual([
    expect.stringContaining(
      "@braintrust/audio is incompatible with this braintrust version. Recording raw PCM.",
    ),
  ]);
});

test("a stack factory that throws records raw PCM without rejecting", async () => {
  vi.stubEnv("BRAINTRUST_AUDIO_COMPRESSION", "true");
  registry[REGISTRY] = {
    version: 1,
    middlewareFromEnv: () => () => {
      throw new Error("encoder setup failed");
    },
  };
  await expect(loadAudioMiddlewareFromEnv()!()).resolves.toEqual([]);
  expect(warnings).toEqual([
    expect.stringContaining("encoder setup failed. Recording raw PCM."),
  ]);
});

test("invalid settings record raw PCM with the package's explanation", async () => {
  vi.stubEnv("BRAINTRUST_AUDIO_MIDDLEWARE", "mp3");
  registry[REGISTRY] = {
    version: 1,
    middlewareFromEnv: () => {
      throw new Error('Unknown audio middleware "mp3"');
    },
  };
  expect(await loadAudioMiddlewareFromEnv()!()).toEqual([]);
  expect(warnings).toEqual([
    expect.stringContaining(
      'Unknown audio middleware "mp3". Recording raw PCM.',
    ),
  ]);
});
