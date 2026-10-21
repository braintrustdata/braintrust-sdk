import type { Span } from "../../logger";
import type { Row } from "./runtime";
import type { ChatMessage } from "./types";
import { Relationships } from "./relationships";

/** Native speech owns transcripts; transcript arrival never changes its timing. */
export class SpeechTracker {
  private rows: Row[] = [];
  private recognition = new Map<number, Row | undefined>();
  private owners = new Map<string, Row>();
  private messageIds = new Map<Row, Set<string>>();
  private pending = new Map<string, { item: ChatMessage; turn?: string }>();

  constructor(
    private relationships: Relationships,
    private content: boolean,
  ) {}

  add(row: Row): void {
    this.rows.push(row);
    for (const { item, turn } of this.pending.values())
      if (item.metrics?.startedSpeakingAt !== undefined)
        this.message(item, { turn });
  }

  recognize(turn: string, startedAt: number): void {
    const speech = this.rows.filter(
      (row) => row.native.name === "user_speaking" && row.turn === turn,
    );
    if (speech.length !== 1 || !Number.isFinite(startedAt)) return;
    const start = startedAt / 1000;
    this.recognition.set(
      start,
      !this.recognition.has(start) || this.recognition.get(start) === speech[0]
        ? speech[0]
        : undefined,
    );
  }

  finish(root: Span): void {
    if (this.pending.size)
      root.log({
        metadata: {
          "contrib.livekit.unassociated_messages": [
            ...this.pending.values(),
          ].map(({ item }) => ({
            id: item.id,
            role: item.role,
            text: item.textContent,
            started_speaking_at: item.metrics?.startedSpeakingAt,
          })),
        },
      });
  }

  message(
    item: ChatMessage,
    {
      turn,
      speech: observed,
      transcribed = false,
    }: { turn?: string; speech?: Row; transcribed?: boolean } = {},
  ): Row | undefined {
    // Keep only transcript observations, never ChatMessage audio/context payloads.
    item = {
      type: item.type,
      id: item.id,
      role: item.role,
      textContent: this.content ? item.textContent : undefined,
      interrupted: item.interrupted,
      metrics: item.metrics && {
        startedSpeakingAt: item.metrics.startedSpeakingAt,
      },
    };
    if (item.role !== "user" && item.role !== "assistant") return;
    const name = item.role === "user" ? "user_speaking" : "agent_speaking";
    const start = item.metrics?.startedSpeakingAt;
    const candidates = this.rows.filter((row) => {
      if (row.native.name !== name) return false;
      if (start !== undefined && Number.isFinite(start))
        return (
          row.start !== undefined &&
          start >= row.start - 0.001 &&
          (row.end === undefined || start <= row.end + 0.001)
        );
      if (turn) return row.turn === turn;
      // A transcription event is evidence of speech; a conversation message can
      // instead be typed input. Do not assign that to old audio.
      return transcribed
        ? !row.ended || !this.messageIds.has(row)
        : item.role === "assistant" && !row.ended;
    });
    const row =
      this.owners.get(item.id) ??
      (item.role === "user" && start !== undefined
        ? this.recognition.get(start)
        : undefined) ??
      (candidates.length === 1 ? candidates[0] : observed);
    if (!row) {
      if (this.pending.size < 8192) this.pending.set(item.id, { item, turn });
      return;
    }
    this.pending.delete(item.id);
    this.owners.set(item.id, row);
    const ids = this.messageIds.get(row) ?? new Set<string>();
    ids.add(item.id);
    this.messageIds.set(row, ids);
    this.relationships.register(`speech:${item.id}`, row.span);
    if (item.role === "assistant")
      this.relationships.reference(
        row.span,
        `generation:${item.id}`,
        "generated_by",
      );
    row.messages ??= new Map();
    if (this.content && item.textContent !== undefined) {
      row.messages.set(item.id, { role: item.role, content: item.textContent });
      row.span.log(
        item.role === "user"
          ? { input: [...row.messages.values()] }
          : { output: [...row.messages.values()] },
      );
    }
    row.span.log({
      metadata: {
        "contrib.livekit.message_ids": [...ids],
        ...(item.interrupted ? { "contrib.livekit.interrupted": true } : {}),
      },
    });
    return row;
  }
}
