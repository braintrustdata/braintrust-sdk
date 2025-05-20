import { expect, test } from "vitest";
import {
  BraintrustStream,
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
        createFinalValuePassThroughStream(
          (v) => {
            finalValue = v;
          },
          (e) => {
            console.error("ERROR", e);
          },
        ),
      )
      .pipeTo(sink);

    expect(finalValue).toBe(expected);
    expect(sinkChunks.map((c) => c.data).join("")).toEqual(expected);
  }
});

test("final value passthrough with abort", async () => {
  const inputStream = new ReadableStream({
    start(controller) {},
  });

  const controller = new AbortController();
  const stream = new BraintrustStream(inputStream, {
    signal: controller.signal,
  });

  controller.abort();

  await expect(stream.finalValue()).rejects.toThrow(
    "This operation was aborted",
  );
});
