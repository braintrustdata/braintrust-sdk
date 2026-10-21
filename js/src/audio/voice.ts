import { createAudioRecording, type AudioRecordingConfig } from "./recording";
import { VoicePublisher, type SpeechSelection } from "./voice-publisher";

interface VoiceRecordingConfig extends Omit<AudioRecordingConfig, "onPublish"> {
  /** Existing speech/turn spans and their known call-relative audio intervals. */
  speechSelections: () => Iterable<SpeechSelection>;
}

/** Voice associations layered over an independently usable audio recording. */
class VoiceRecording {
  readonly audio: ReturnType<typeof createAudioRecording>;
  private readonly publisher: VoicePublisher;
  constructor(config: VoiceRecordingConfig) {
    const { speechSelections, ...audioConfig } = config;
    this.publisher = new VoicePublisher(
      () => this.audio.segments,
      speechSelections,
    );
    this.audio = createAudioRecording({
      ...audioConfig,
      onPublish: () => this.publisher.publish(),
      flush: async () => {
        try {
          await config.flush();
        } catch (error) {
          this.publisher.reset();
          throw error;
        }
      },
    });
  }
  publishSelections(): void {
    this.publisher.publish();
  }
  finish(): Promise<void> {
    return this.audio.finish();
  }
}

/** Publish voice playback associations using supplied bounds; no alignment is inferred. */
export function createVoiceRecording(config: VoiceRecordingConfig) {
  return new VoiceRecording(config);
}
