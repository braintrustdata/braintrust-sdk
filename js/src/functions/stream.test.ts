import { expect, test } from "vitest";
import {
  BraintrustStreamChunk,
  createFinalValuePassThroughStream,
} from "./stream";

const cases: {
  chunks: (string | Uint8Array | BraintrustStreamChunk)[];
  expected: string;
}[] = [
  {
    chunks: [
      { type: "text_delta", data: "Hello, " },
      { type: "text_delta", data: "world!" },
    ],
    expected: "Hello, world!",
  },
];

test("final value passthrough", async () => {
  for (const { chunks, expected } of cases) {
    const inputStream = new ReadableStream({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(c);
        }
        controller.close();
      },
    });

    const sinkChunks: BraintrustStreamChunk[] = [];
    const sink = new WritableStream<BraintrustStreamChunk>({
      write(chunk) {
        sinkChunks.push(chunk);
      },
    });

    let finalValue: unknown = null;
    await inputStream
      .pipeThrough(
        createFinalValuePassThroughStream((v) => {
          finalValue = v;
        }),
      )
      .pipeTo(sink);

    expect(finalValue).toBe(expected);
    expect(sinkChunks.map((c) => c.data).join("")).toEqual(expected);
  }
});
