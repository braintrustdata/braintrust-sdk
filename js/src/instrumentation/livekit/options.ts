import type { RecordingOptions } from "./audio";

export interface LiveKitOptions {
  captureContent?: boolean;
  captureAudio?: boolean;
  captureUserAudio?: boolean;
  captureAgentAudio?: boolean;
  audioFormat?: "wav" | "ogg";
  recording?: RecordingOptions;
}
