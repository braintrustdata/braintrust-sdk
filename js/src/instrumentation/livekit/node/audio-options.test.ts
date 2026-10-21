import { beforeEach, afterEach, expect, test, vi } from "vitest";
import * as extension from "../../../audio/index";
import { resolveAudioOptions } from "./audio-options";
beforeEach(() => {
  for (const key of [
    "BRAINTRUST_CAPTURE_ATTACHMENTS",
    "BRAINTRUST_CAPTURE_USER_AUDIO_ATTACHMENTS",
    "BRAINTRUST_CAPTURE_AGENT_AUDIO_ATTACHMENTS",
  ])
    vi.stubEnv(key, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
test("disabled capture never loads the recorder, even when installed and environment-enabled", () => {
  vi.stubEnv("BRAINTRUST_CAPTURE_AGENT_AUDIO_ATTACHMENTS", "true");
  const load = vi.fn(() => extension);
  expect(resolveAudioOptions({ captureAudio: false }, load)).toEqual({
    user: false,
    agent: false,
  });
  expect(load).not.toHaveBeenCalled();
});
test.each(["true", "1", " TRUE "])(
  "participant options override the %s audio environment opt-in",
  (value) => {
    vi.stubEnv("BRAINTRUST_CAPTURE_ATTACHMENTS", "false");
    vi.stubEnv("BRAINTRUST_CAPTURE_AGENT_AUDIO_ATTACHMENTS", value);
    vi.stubEnv("BRAINTRUST_CAPTURE_USER_AUDIO_ATTACHMENTS", "false");
    const load = vi.fn(() => extension);
    expect(resolveAudioOptions({}, load)).toEqual({
      user: false,
      agent: true,
      extension,
    });
    expect(
      resolveAudioOptions(
        { captureAudio: false, captureAgentAudio: true },
        load,
      ),
    ).toEqual({ user: false, agent: true, extension });
  },
);
test("enabled capture uses the SDK recorder without an extension", () => {
  expect(resolveAudioOptions({ captureAudio: true })).toMatchObject({
    user: true,
    agent: true,
    extension,
  });
});

test("generic attachment capture does not enable voice recording or load the extension", () => {
  vi.stubEnv("BRAINTRUST_CAPTURE_ATTACHMENTS", "true");
  const load = vi.fn(() => extension);
  expect(resolveAudioOptions({}, load)).toEqual({ user: false, agent: false });
  expect(load).not.toHaveBeenCalled();
  vi.stubEnv("BRAINTRUST_CAPTURE_USER_AUDIO_ATTACHMENTS", "true");
  expect(resolveAudioOptions({}, load)).toEqual({
    user: true,
    agent: false,
    extension,
  });
});
