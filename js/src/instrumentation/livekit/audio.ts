import type * as audio from "../../audio";

/** Shared recorder types used by the LiveKit integration. */
export type { RecordingOptions, Packet, Selection } from "../../audio";
export type AudioRecordingModule = typeof audio;
export type Recording = ReturnType<
  AudioRecordingModule["createAudioRecording"]
>;
