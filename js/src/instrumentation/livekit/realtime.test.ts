/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import { RealtimeObserver } from "./realtime";

test("observes transcript identity before native commit without creating turns or consuming events", () => {
  const session = new EventEmitter();
  const order: string[] = [];
  session.on("input_audio_transcription_completed", () => order.push("native"));
  const transcript = vi.fn(() => order.push("observer"));
  const observer = new RealtimeObserver(session, true, transcript);
  const event = {
    itemId: "u1",
    transcript: "Order 1042",
    turnStartedAt: 1000,
    isFinal: true,
  };
  session.emit("input_audio_transcription_completed", event);
  expect(order).toEqual(["observer", "native"]);
  expect(transcript).toHaveBeenCalledWith(event, false);
  observer.close();
  expect(session.listenerCount("input_audio_transcription_completed")).toBe(1);
});

test.each([true, false])(
  "observed context excludes generated output and never appends unobserved transcripts (content %s)",
  (content) => {
    const session = Object.assign(new EventEmitter(), {
      chatCtx: {
        items: [
          {
            type: "message",
            id: "u1",
            role: "user",
            content: ["Where is my order?"],
          },
          { type: "function_call_output", callId: "lookup", output: "Friday" },
          {
            type: "message",
            id: "answer",
            role: "assistant",
            content: ["Friday."],
          },
        ],
      },
    });
    const observer = new RealtimeObserver(session, content, () => {});
    const log = vi.fn(),
      context = vi.fn();
    const exclude = observer.captureInput({ log } as any, context);
    session.emit("input_audio_transcription_completed", {
      itemId: "later",
      transcript: "Unobserved input",
    });
    exclude.exclude("answer");
    exclude.finish();
    expect(context).toHaveBeenLastCalledWith(session.chatCtx.items.slice(0, 2));
    if (content)
      expect(log.mock.calls.at(-1)![0].input).toEqual([
        { role: "user", content: "Where is my order?" },
        { role: "tool", content: "Friday", tool_call_id: "lookup" },
      ]);
    else expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("Unobserved input");
    observer.close();
  },
);

test.each([true, false])(
  "response context retains observed partial identities and accepts late completion (content %s)",
  (content) => {
    const session = Object.assign(new EventEmitter(), {
      chatCtx: { items: [] },
    });
    const observer = new RealtimeObserver(session, content, () => {});
    session.emit("input_audio_transcription_completed", {
      itemId: "thanks",
      transcript: "Alright",
      isFinal: false,
    });
    const log = vi.fn(),
      context = vi.fn();
    const response = observer.captureInput({ log } as any, context);
    response.finish();
    expect(context.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ id: "thanks", role: "user" }),
    ]);
    session.emit("input_audio_transcription_completed", {
      itemId: "future",
      transcript: "Another question",
      isFinal: false,
    });
    session.emit("input_audio_transcription_completed", {
      itemId: "thanks",
      transcript: "Alright, thank you",
      isFinal: true,
    });
    if (content)
      expect(log.mock.calls.at(-1)?.[0].input).toEqual([
        { role: "user", content: "Alright, thank you" },
      ]);
    else expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("Another question");
    expect(context.mock.calls.at(-1)?.[0].map((item: any) => item.id)).toEqual([
      "thanks",
    ]);
    observer.close();
  },
);

test.each([true, false])(
  "context scope is stable regardless of native transcript commit timing (%s)",
  (committed) => {
    const item = {
      type: "message",
      id: "user",
      role: "user",
      content: ["Thanks"],
    };
    const session = Object.assign(new EventEmitter(), {
      chatCtx: { items: committed ? [item] : [] },
    });
    const observer = new RealtimeObserver(session, true, () => {});
    session.emit("input_audio_transcription_completed", {
      itemId: "user",
      transcript: "Thanks",
      isFinal: committed,
    });
    const log = vi.fn();
    observer.captureInput({ log } as any, () => {}).finish();
    expect(log.mock.calls.at(-1)?.[0]).toEqual({
      input: [{ role: "user", content: "Thanks" }],
      metadata: {
        "contrib.livekit.input_scope":
          "realtime_session_context_and_observed_transcripts",
      },
    });
    observer.close();
  },
);
