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

type Transcript = {
  item: { type: "message"; id: string; role: "user"; content: string[] };
  final: boolean;
  updates: Set<() => void>;
};

/** Observes common realtime events without reconstructing conversation turns. */
export class RealtimeObserver {
  private usage: RealtimeMetrics;
  private transcripts = new Map<string, Transcript>();
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
      observe(() => {
        transcript(event, dispatch !== undefined);
        if (typeof event.itemId !== "string") return;
        let entry = this.transcripts.get(event.itemId);
        if (!entry) {
          if (this.transcripts.size >= 8192) return;
          entry = {
            item: {
              type: "message",
              id: event.itemId,
              role: "user",
              content: [],
            },
            final: false,
            updates: new Set(),
          };
          this.transcripts.set(event.itemId, entry);
        }
        if (this.content && typeof event.transcript === "string")
          entry.item.content = [event.transcript];
        entry.final = event.isFinal === true;
        // Partial fragments update the shared item without repeatedly logging
        // the entire conversation. Publish again at completion.
        if (entry.final) for (const update of entry.updates) update();
      });
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
    const ids = new Set(
      items.map((item) =>
        typeof item === "object" && item !== null && "id" in item
          ? item.id
          : undefined,
      ),
    );
    // Freeze membership at response start, not the text of an already-observed
    // partial transcript. Later, unrelated speech must never enter this snapshot.
    const partials: Transcript[] = [];
    for (const [id, entry] of this.transcripts) {
      if (entry.final && ids.has(id) && entry.updates.size === 0) {
        this.transcripts.delete(id);
        continue;
      }
      const index = items.findIndex(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          item.id === id,
      );
      if (index < 0) items.push(entry.item);
      else items[index] = entry.item;
      partials.push(entry);
    }
    const excluded = new Set<string>();
    let finished = false;
    const input = () =>
      items.filter(
        (item) =>
          !(
            typeof item === "object" &&
            item !== null &&
            "id" in item &&
            excluded.has(String(item.id))
          ),
      );
    const update = () => {
      const observed = input();
      if (this.content)
        model.log({
          input: messages(observed) ?? [],
          metadata: {
            "contrib.livekit.input_scope":
              "realtime_session_context_and_observed_transcripts",
          },
        });
      if (finished) {
        context(observed);
        if (partials.every((entry) => entry.final))
          for (const entry of partials) entry.updates.delete(update);
      }
    };
    for (const entry of partials) if (!entry.final) entry.updates.add(update);
    update();
    return {
      exclude: (id) => {
        excluded.add(id);
        update();
      },
      finish: () => {
        finished = true;
        update();
      },
    };
  }

  captureMetrics(responseId: string, span: Span) {
    this.usage.associate(responseId, span);
  }

  close() {
    this.usage.close();
    this.transcripts.clear();
    this.session.off("input_audio_transcription_completed", this.transcript);
    this.session.off("input_speech_started", this.started);
  }
}
