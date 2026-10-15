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
