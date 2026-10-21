import type { AudioRecordingModule } from "../audio";
import * as audio from "../../../audio";
import type { LiveKitOptions } from "../options";

export function resolveAudioOptions(
  options: LiveKitOptions,
  loadRecording: () => AudioRecordingModule = () => audio,
) {
  const flag = (name: string) => {
    const value = process.env[name];
    return (
      value !== undefined && ["1", "true"].includes(value.trim().toLowerCase())
    );
  };
  const user =
    options.captureUserAudio ??
    options.captureAudio ??
    flag("BRAINTRUST_CAPTURE_USER_AUDIO_ATTACHMENTS");
  const agent =
    options.captureAgentAudio ??
    options.captureAudio ??
    flag("BRAINTRUST_CAPTURE_AGENT_AUDIO_ATTACHMENTS");
  if (!user && !agent) return { user, agent };
  return { user, agent, extension: loadRecording() };
}
