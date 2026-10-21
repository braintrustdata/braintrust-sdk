import type { RecordingSpan } from "./publisher";
import type { Segment } from "./segment";
import {
  mergeSelections,
  segmentSelections,
  type Selection,
} from "./selections";
export type SpeechSelection = {
  span: Pick<RecordingSpan, "log">;
  intervals: Selection[];
  alias?: boolean;
  metadata?: Record<string, unknown>;
};

/** Maps voice spans onto ready audio files; does not encode or upload audio. */
export class VoicePublisher {
  private publishedSelections = new WeakMap<object, string>();
  constructor(
    private segments: () => readonly Segment[],
    private speechSelections: () => Iterable<SpeechSelection>,
  ) {}
  reset(): void {
    this.publishedSelections = new WeakMap();
  }
  publish() {
    const segments = this.segments();
    for (const turn of this.speechSelections()) {
      const selections = segmentSelections(
        mergeSelections(turn.intervals),
        segments,
      );
      const metadata = {
        "audio.selections": selections,
        ...(turn.alias
          ? {
              "audio.selection": selections.length === 1 ? selections[0] : null,
            }
          : {}),
        ...turn.metadata,
      };
      const signature = JSON.stringify(metadata);
      if (this.publishedSelections.get(turn.span) === signature) {
        continue;
      }
      turn.span.log({ metadata });
      this.publishedSelections.set(turn.span, signature);
    }
  }
}
