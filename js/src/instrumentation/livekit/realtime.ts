import { RealtimeMetrics } from "./realtime-metrics";
import type { Span } from "../../logger";
import { observe } from "./runtime";
import { messages } from "./schema";

type Listener = (event: Record<string, unknown>) => void;
export interface RealtimeSession {
  readonly chatCtx?: { items: unknown[] };
  on(name: string | symbol, callback: Listener): unknown;
  prependListener?(name: string | symbol, callback: Listener): unknown;
  off(name: string | symbol, callback: Listener): unknown;
}

/** Observes common realtime events without reconstructing conversation turns. */
export class RealtimeObserver {
  private usage: RealtimeMetrics;
  private readonly transcript: Listener;
  private readonly started: Listener;

  constructor(
    readonly session: RealtimeSession,
    private content: boolean,
    transcript: (event: Record<string, unknown>, sameDispatch: boolean) => void,
  ) {
    this.usage = new RealtimeMetrics(session);
    let dispatch: object | undefined;
    this.started = () => {
      const token = {};
      dispatch = token;
      queueMicrotask(() => {
        if (dispatch === token) dispatch = undefined;
      });
    };
    session.on("input_speech_started", this.started);
    this.transcript = (event) =>
      observe(() => transcript(event, dispatch !== undefined));
    // LiveKit's listener commits the same message. Observe its native identity
    // first, including partial transcripts that may arrive before the commit.
    if (session.prependListener)
      session.prependListener(
        "input_audio_transcription_completed",
        this.transcript,
      );
    else session.on("input_audio_transcription_completed", this.transcript);
  }

  captureInput(
    model: Span,
    context: (items: unknown[]) => void,
  ): { exclude(id: string): void; finish(): void } {
    const items = [...(this.session.chatCtx?.items ?? [])];
    const excluded = new Set<string>();
    const update = () => {
      const input = items.filter(
        (item) =>
          !(
            typeof item === "object" &&
            item !== null &&
            "id" in item &&
            excluded.has(String(item.id))
          ),
      );
      if (this.content)
        model.log({
          input: messages(input) ?? [],
          metadata: {
            "contrib.livekit.input_scope": "realtime_session_context",
          },
        });
    };
    // Defer association until generated message IDs have been removed from the
    // snapshot. Some adapters insert their output before dispatching generation.
    if (this.content) model.log({ input: messages(items) ?? [] });
    return {
      exclude: (id) => {
        excluded.add(id);
        update();
      },
      finish: () =>
        context(
          items.filter(
            (item) =>
              !(
                typeof item === "object" &&
                item !== null &&
                "id" in item &&
                excluded.has(String(item.id))
              ),
          ),
        ),
    };
  }

  captureMetrics(responseId: string, span: Span) {
    this.usage.associate(responseId, span);
  }

  close() {
    this.usage.close();
    this.session.off("input_audio_transcription_completed", this.transcript);
    this.session.off("input_speech_started", this.started);
  }
}
