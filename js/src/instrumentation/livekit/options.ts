import type { RecordingOptions } from "./audio";

export interface LiveKitOptions {
  captureContent?: boolean;
  captureAudio?: boolean;
  captureUserAudio?: boolean;
  captureAgentAudio?: boolean;
  recording?: RecordingOptions;
}
